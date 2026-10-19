import type { Prisma, PrismaClient } from '@prisma/client'
import { AlertSeverity, DemandLevel } from '@prisma/client'
import { addUtcDays } from '../lib/date.js'

// デモ用のホテルデータを作る（seed とトライアルの発行で共用 — トライアル）。
//
// 部屋タイプ・料金ランク・価格戦略・競合・過去90日の実績と今後90日の予測・内訳・前年の実績・ブッキングカーブ・
// 競合価格・予算・アラート・AIコメント・着地・口コミ・イベント・周辺の新規ホテルを、指定したテナント×ホテルに入れる。
// 決定的な擬似乱数を使うので、同じ日に作れば同じ値になる（seed の冪等性 — M-4）。
// 既存の行は削除・upsert で置き換えるので、同じホテルに対して何度呼んでもよい。

type Db = PrismaClient | Prisma.TransactionClient

function createRng(seed: number) {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
}

export const DEMO_PRICE_RANK_COUNT = 40 // F-SET-02: 最大40段階

export async function populateDemoHotelData(
  db: Db,
  params: { tenantId: string; hotelId: string; today: Date }
): Promise<void> {
  const { tenantId, hotelId, today } = params
  const rng = createRng(20260704)
  const addDays = addUtcDays
  const PRICE_RANK_COUNT = DEMO_PRICE_RANK_COUNT

  // 3. Room types
  const roomTypes = [
    { code: 'STD_SINGLE', name: 'スタンダードシングル', capacity: 1, count: 80, sortOrder: 1 },
    { code: 'STD_DOUBLE', name: 'スタンダードダブル', capacity: 2, count: 40, sortOrder: 2 },
    { code: 'MOD_TWIN', name: 'モデレートツイン', capacity: 2, count: 50, sortOrder: 3 },
    { code: 'DLX_TWIN', name: 'デラックスツイン', capacity: 2, count: 20, sortOrder: 4 },
    { code: 'TRIPLE', name: 'トリプル', capacity: 3, count: 10, sortOrder: 5 },
  ]

  for (const rt of roomTypes) {
    await db.roomType.upsert({
      where: { hotelId_code: { hotelId, code: rt.code } },
      update: { tenantId },
      create: { hotelId, tenantId, ...rt },
    })
  }

  // 4. Price ranks (40段階)
  for (let i = 1; i <= PRICE_RANK_COUNT; i++) {
    const ratio = (i - 1) / (PRICE_RANK_COUNT - 1)
    const base1P = Math.round(6500 + ratio * 23500) // 6,500 ~ 30,000
    await db.priceRank.upsert({
      where: { hotelId_rank: { hotelId, rank: i } },
      update: { tenantId },
      create: {
        hotelId,
        tenantId,
        rank: i,
        label: `R${String(i).padStart(2, '0')}`,
        price1P: base1P,
        price2P: Math.round(base1P * 1.4),
        price3P: Math.round(base1P * 1.8),
      },
    })
  }

  // 6. Pricing strategy config
  await db.pricingStrategyConfig.upsert({
    where: { hotelId },
    update: {},
    create: {
      hotelId,
      tenantId,
      weightOccupancy: 40,
      weightAdr: 40,
      weightCompetitor: 20,
    },
  })

  // 7. Competitors（冪等にするため既存を削除して再作成）
  await db.competitor.deleteMany({ where: { hotelId } })
  const competitorRecords = []
  const competitors = [
    { name: '競合ホテルA', category: '同カテゴリ' },
    { name: '競合ホテルB', category: '同カテゴリ' },
    { name: '競合ホテルC', category: '上位カテゴリ' },
  ]
  for (const comp of competitors) {
    const rec = await db.competitor.create({
      data: {
        hotelId,
        tenantId,
        otaUrls: { rakuten: null, jalan: null, ikkyu: null, expedia: null, agoda: null },
        ...comp,
      },
    })
    competitorRecords.push(rec)
  }

  // 8. 日別データ: 過去90日実績 + 今後90日AI予測
  const totalRooms = 200

  await db.dailyData.deleteMany({ where: { hotelId } })
  await db.aiPriceRecommendation.deleteMany({ where: { hotelId } })
  await db.bookingCurveData.deleteMany({ where: { hotelId } })
  await db.competitorPriceData.deleteMany({ where: { tenantId } })

  const dailyRows = []
  const aiRows = []
  for (let offset = -90; offset <= 90; offset++) {
    const date = addDays(today, offset)
    const dow = date.getUTCDay()
    const isWeekend = dow === 5 || dow === 6 // 金・土
    const seasonBoost = 1 + 0.1 * Math.sin(((date.getUTCMonth() + 1) / 12) * Math.PI * 2)

    const baseOcc = (isWeekend ? 0.9 : 0.72) * seasonBoost
    const occupancy = Math.min(1, Math.max(0.3, baseOcc + (rng() - 0.5) * 0.12))
    const adr = Math.round((isWeekend ? 23000 : 16500) * seasonBoost + (rng() - 0.5) * 2000)
    const soldRooms = Math.round(totalRooms * occupancy)
    const totalRevenue = soldRooms * adr
    const revPar = Math.round(totalRevenue / totalRooms)
    const guests = Math.round(soldRooms * (1.3 + rng() * 0.4))

    if (offset <= 0) {
      // 過去〜当日: 実績
      dailyRows.push({
        hotelId,
        tenantId,
        date,
        occupancy: Math.round(occupancy * 1000) / 1000,
        adr,
        revPar,
        totalRevenue,
        soldRooms,
        guests,
      })
    }

    // 全期間: AI予測・推奨
    const predictedOcc = Math.min(1, Math.max(0.3, baseOcc + (rng() - 0.5) * 0.06))
    const demandLevel =
      predictedOcc > 0.9 ? DemandLevel.A :
      predictedOcc > 0.8 ? DemandLevel.B :
      predictedOcc > 0.65 ? DemandLevel.C :
      predictedOcc > 0.5 ? DemandLevel.D : DemandLevel.E
    const recommendedRank = Math.min(
      PRICE_RANK_COUNT,
      Math.max(1, Math.round(predictedOcc * PRICE_RANK_COUNT))
    )
    aiRows.push({
      hotelId,
      tenantId,
      date,
      predictedOccupancy: Math.round(predictedOcc * 1000) / 1000,
      predictedAdr: Math.round((isWeekend ? 24000 : 17000) * seasonBoost),
      recommendedRank,
      recommendedPrice: Math.round(6500 + ((recommendedRank - 1) / (PRICE_RANK_COUNT - 1)) * 23500),
      demandLevel,
      confidence: Math.round((0.7 + rng() * 0.25) * 100) / 100,
      modelVersion: 'seed-v1',
    })
  }
  await db.dailyData.createMany({ data: dailyRows })
  await db.aiPriceRecommendation.createMany({ data: aiRows })

  // 8b. チャネル別・部屋タイプ別の内訳（#88）。日次実績の販売室数・売上をちょうど分け合うように作る。
  // 既存の数値が変わらないよう、ここだけ別の乱数列を使う
  const breakdownRng = createRng(20260923)
  await db.otaChannelData.deleteMany({ where: { hotelId } })
  // DailyRoomData は DailyData の削除に連動して消えている（onDelete: Cascade）

  /** 合計を保ったまま整数に割り振る（最大剰余法） */
  const allocate = (total: number, weights: number[]): number[] => {
    const sum = weights.reduce((a, b) => a + b, 0)
    const exact = weights.map((w) => (total * w) / sum)
    const floors = exact.map(Math.floor)
    let rest = total - floors.reduce((a, b) => a + b, 0)
    const order = exact.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0])
    for (const [, i] of order) {
      if (rest <= 0) break
      floors[i] += 1
      rest -= 1
    }
    return floors
  }

  const channels = [
    { name: '公式サイト', share: 0.3, adrFactor: 1.05 },
    { name: '楽天トラベル', share: 0.25, adrFactor: 0.98 },
    { name: 'じゃらん', share: 0.2, adrFactor: 0.97 },
    { name: '一休', share: 0.1, adrFactor: 1.15 },
    { name: 'Expedia', share: 0.08, adrFactor: 0.95 },
    { name: 'Agoda', share: 0.07, adrFactor: 0.92 },
  ]
  const seededRoomTypes = await db.roomType.findMany({
    where: { hotelId, isActive: true },
    orderBy: { sortOrder: 'asc' },
  })
  const savedDaily = await db.dailyData.findMany({
    where: { hotelId },
    select: { id: true, date: true, soldRooms: true, totalRevenue: true },
  })

  const channelRows: Prisma.OtaChannelDataCreateManyInput[] = []
  const roomRows: Prisma.DailyRoomDataCreateManyInput[] = []
  for (const day of savedDaily) {
    const sold = day.soldRooms ?? 0
    const revenue = day.totalRevenue ?? 0
    if (sold === 0) continue

    const channelRooms = allocate(sold, channels.map((c) => c.share * (0.85 + breakdownRng() * 0.3)))
    const channelWeights = channels.map((c, i) => channelRooms[i] * c.adrFactor)
    const weightSum = channelWeights.reduce((a, b) => a + b, 0) || 1
    channels.forEach((c, i) => {
      if (channelRooms[i] === 0) return
      const channelRevenue = Math.round((revenue * channelWeights[i]) / weightSum)
      channelRows.push({
        hotelId,
        tenantId,
        date: day.date,
        channel: c.name,
        roomsSold: channelRooms[i],
        revenue: channelRevenue,
        adr: Math.round(channelRevenue / channelRooms[i]),
      })
    })

    // 部屋タイプは室数に比例し、上位タイプほど単価が高い（sortOrder が後ろほど高い）
    const typeRooms = allocate(sold, seededRoomTypes.map((t) => t.count * (0.8 + breakdownRng() * 0.4)))
    const typeWeights = seededRoomTypes.map((t, i) => typeRooms[i] * (1 + t.sortOrder * 0.12))
    const typeWeightSum = typeWeights.reduce((a, b) => a + b, 0) || 1
    seededRoomTypes.forEach((t, i) => {
      if (typeRooms[i] === 0) return
      roomRows.push({
        tenantId,
        dailyDataId: day.id,
        roomTypeId: t.id,
        soldRooms: typeRooms[i],
        revenue: Math.round((revenue * typeWeights[i]) / typeWeightSum),
      })
    })
  }
  await db.otaChannelData.createMany({ data: channelRows })
  await db.dailyRoomData.createMany({ data: roomRows })

  // 8c. 前年の実績（前年同曜日 = 364日前 との比較用 — 2026-10）。
  // 料金カレンダーの日割り予算・日のタイプ、日別パフォーマンスの前年比、ブッキングカーブの参考カーブが使う。
  // 直近90日の値が変わらないよう別の乱数列を使い、内訳（8b）は作らない
  const lastYearRng = createRng(20261019)
  const lastYearRows = []
  for (let offset = -455; offset < -90; offset++) {
    const date = addDays(today, offset)
    const dow = date.getUTCDay()
    const isWeekend = dow === 5 || dow === 6
    const seasonBoost = 1 + 0.1 * Math.sin(((date.getUTCMonth() + 1) / 12) * Math.PI * 2)
    // 前年は今年より少し弱い（稼働 −3pt・単価 −4%）
    const occupancy = Math.min(1, Math.max(0.3, (isWeekend ? 0.87 : 0.69) * seasonBoost + (lastYearRng() - 0.5) * 0.12))
    const adr = Math.round(((isWeekend ? 23000 : 16500) * seasonBoost + (lastYearRng() - 0.5) * 2000) * 0.96)
    const soldRooms = Math.round(totalRooms * occupancy)
    lastYearRows.push({
      hotelId,
      tenantId,
      date,
      occupancy: Math.round(occupancy * 1000) / 1000,
      adr,
      revPar: Math.round((soldRooms * adr) / totalRooms),
      totalRevenue: soldRooms * adr,
      soldRooms,
      guests: Math.round(soldRooms * (1.3 + lastYearRng() * 0.4)),
    })
  }
  await db.dailyData.createMany({ data: lastYearRows })

  // 9. ブッキングカーブ（過去90日〜今後90日の宿泊日と、その前年同曜日の宿泊日 × 残日数）。
  // 結果の出た宿泊日は最終の販売室数まで、先の宿泊日は「今日の取り込み」（残日数 = 今日からの日数）までの予約積上を作る。
  // OTB は毎日取り込む前提（#24 E2）なので、今日の時点の記録は必ずある。
  // 行数がトライアル発行の速さに効くため、前年は比べる相手になる日（−455〜−273日）だけにする
  const curveRng = createRng(20261020)
  const CURVE_LEADS = [180, 120, 90, 60, 45, 30, 21, 14, 7, 3, 1, 0]
  const finalByDate = new Map<number, number>()
  for (const row of [...lastYearRows, ...dailyRows]) finalByDate.set(row.date.getTime(), row.soldRooms)
  const predictedByDate = new Map(aiRows.map((r) => [r.date.getTime(), r.predictedOccupancy]))
  const curveRows = []
  for (let offset = -455; offset <= 90; offset++) {
    if (offset > -273 && offset < -90) continue
    const stayDate = addDays(today, offset)
    const finalRooms =
      offset <= 0 ? finalByDate.get(stayDate.getTime()) : Math.round(totalRooms * (predictedByDate.get(stayDate.getTime()) ?? 0.7))
    if (finalRooms == null) continue
    // 週末は早めに埋まる。残日数が大きい順に積み上げ、前の時点を下回らないようにする
    const curvePower = stayDate.getUTCDay() === 5 || stayDate.getUTCDay() === 6 ? 1.5 : 1.9
    // 先の宿泊日は今日の時点まで。前年の宿泊日には、今年の同じ曜日の「今日の時点」と同じ残日数も入れる（ペースを比べるため）
    const counterpart = offset + 364
    const leads =
      offset > 0
        ? [...CURVE_LEADS.filter((l) => l > offset), offset]
        : offset <= -273 && counterpart > 0 && !CURVE_LEADS.includes(counterpart)
          ? [...CURVE_LEADS, counterpart].sort((a, b) => b - a)
          : CURVE_LEADS
    let booked = 0
    for (const daysBefore of leads) {
      const progress = Math.pow(1 - daysBefore / 190, curvePower)
      const noisy = daysBefore === 0 ? finalRooms : Math.round(finalRooms * Math.min(1, progress * (0.92 + curveRng() * 0.12)))
      booked = Math.max(booked, Math.min(noisy, finalRooms))
      curveRows.push({ hotelId, tenantId, stayDate, daysBefore, roomsBooked: booked })
    }
  }
  await db.bookingCurveData.createMany({ data: curveRows })

  // 10. 競合価格（過去30日〜今後30日）
  const compPriceRows = []
  for (const comp of competitorRecords) {
    const bias = 0.9 + rng() * 0.25
    for (let offset = -30; offset <= 30; offset++) {
      const date = addDays(today, offset)
      const dow = date.getUTCDay()
      const isWeekend = dow === 5 || dow === 6
      const price1P = Math.round(((isWeekend ? 22000 : 15500) * bias + (rng() - 0.5) * 1500) / 100) * 100
      compPriceRows.push({
        competitorId: comp.id,
        tenantId,
        date,
        price1P,
        price2P: Math.round((price1P * 1.8) / 100) * 100,
        price3P: Math.round((price1P * 2.4) / 100) * 100,
        dataSource: 'seed',
        reliability: 'medium',
      })
    }
  }
  await db.competitorPriceData.createMany({ data: compPriceRows })

  // 11. 月次予算（当月±3ヶ月）
  for (let m = -3; m <= 3; m++) {
    const target = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + m, 1))
    const year = target.getUTCFullYear()
    const month = target.getUTCMonth() + 1
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const budgetOccupancy = 0.78
    const budgetAdr = 18500
    const budgetRooms = Math.round(totalRooms * budgetOccupancy * daysInMonth)
    await db.monthlyBudget.upsert({
      where: { hotelId_year_month: { hotelId, year, month } },
      update: {},
      create: {
        hotelId,
        tenantId,
        year,
        month,
        budgetOccupancy,
        budgetAdr,
        budgetRooms,
        budgetRevenue: budgetRooms * budgetAdr,
        budgetGuests: Math.round(budgetRooms * 1.5),
        lastYearOccupancy: 0.74,
        lastYearAdr: 17200,
        lastYearRooms: Math.round(totalRooms * 0.74 * daysInMonth),
        lastYearRevenue: Math.round(totalRooms * 0.74 * daysInMonth) * 17200,
        lastYearGuests: Math.round(totalRooms * 0.74 * daysInMonth * 1.5),
      },
    })
  }

  // 12. アラート・AIコメント（デモ用）
  await db.alert.deleteMany({ where: { hotelId } })
  await db.alert.createMany({
    data: [
      // Level 5: 即時対応（ダッシュボード表示対象）
      {
        hotelId,
        tenantId,
        severity: AlertSeverity.RED,
        level: 5,
        title: '稼働率が予算を大幅に下回っています',
        message: '来週火曜の予約積上が予算比 -18pt です。価格ランクの引き下げを検討してください。',
        linkTab: 'pricing',
        targetDate: addDays(today, 4),
      },
      // Level 4: 1週間内の経過観察（ダッシュボード表示対象）
      {
        hotelId,
        tenantId,
        severity: AlertSeverity.YELLOW,
        level: 4,
        title: '競合価格との乖離が拡大',
        message: '今週末の自社価格が競合水準より 12% 高くなっています。経過観察してください。',
        linkTab: 'daily',
        targetDate: addDays(today, 2),
      },
      // Level 3以下: ダッシュボードには表示せず、各分析画面で確認する想定
      {
        hotelId,
        tenantId,
        severity: AlertSeverity.YELLOW,
        level: 3,
        title: 'OTA別の予約構成比に変化',
        message: '公式サイト経由の構成比が前月比 -4pt です。チャネル分析で推移を確認してください。',
        linkTab: 'analysis',
        targetDate: addDays(today, 7),
      },
      {
        hotelId,
        tenantId,
        severity: AlertSeverity.YELLOW,
        level: 2,
        title: '翌月の予算未登録',
        message: '翌月の予算データが未登録です。設定画面から登録してください。',
        linkTab: 'settings',
        targetDate: null,
      },
      {
        hotelId,
        tenantId,
        severity: AlertSeverity.YELLOW,
        level: 1,
        title: '料金ランクの見直し推奨',
        message: '直近30日で未使用の料金ランクが3件あります。マスタ整理を検討してください。',
        linkTab: 'settings',
        targetDate: null,
      },
    ],
  })

  await db.aiComment.deleteMany({ where: { hotelId } })
  await db.aiComment.create({
    data: {
      hotelId,
      tenantId,
      section: 'dashboard-summary',
      content:
        '今月の稼働率は予算比 +2.1pt と好調に推移しています。週末（金・土）のADRは前年比 +6% で、' +
        '特に土曜日は満室に近い水準です。一方、平日火曜・水曜の稼働が予算を下回っており、' +
        '平日限定プランまたは料金ランク引き下げの検討を推奨します。',
      modelVersion: 'seed-v1',
    },
  })

  // 13. 月間着地シミュレーション（当月）
  await db.monthlyLandingSimulation.upsert({
    where: {
      hotelId_year_month: {
        hotelId,
        year: today.getUTCFullYear(),
        month: today.getUTCMonth() + 1,
      },
    },
    update: {},
    create: {
      hotelId,
      tenantId,
      year: today.getUTCFullYear(),
      month: today.getUTCMonth() + 1,
      projectedOccupancy: 0.81,
      projectedAdr: 18900,
      projectedRevPar: 15300,
      projectedRooms: 4980,
      projectedRevenue: 4980 * 18900,
    },
  })

  // 14. 口コミ評価点（F-ANA-04 / N-7）
  // ReviewScore には一意制約が無いため、冪等性は「削除して作り直す」方式で担保する
  // （競合・アラートと同じパターン）。
  // 実運用ではOTAスクレイピング（Phase 4）が書き込む想定のテーブル。
  await db.reviewScore.deleteMany({ where: { hotelId } })
  const reviewSources = [
    { source: 'rakuten', base: 4.32, reviewCount: 1840 },
    { source: 'jalan', base: 4.18, reviewCount: 1260 },
    { source: 'ikkyu', base: 4.45, reviewCount: 430 },
    { source: 'google', base: 4.05, reviewCount: 2210 },
    { source: 'tripadvisor', base: 4.21, reviewCount: 760 },
  ]
  const reviewRows = []
  // 直近6か月ぶんを月初時点の取得値として並べる（推移グラフ用）
  for (let monthsAgo = 5; monthsAgo >= 0; monthsAgo--) {
    const capturedAt = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - monthsAgo, 1)
    )
    for (const src of reviewSources) {
      // 月を追うごとにわずかに改善する想定。rng は決定的なので再実行しても同じ値になる
      const drift = (5 - monthsAgo) * 0.02 + (rng() - 0.5) * 0.06
      reviewRows.push({
        hotelId,
        tenantId,
        source: src.source,
        score: Math.round(Math.min(5, Math.max(1, src.base + drift)) * 100) / 100,
        reviewCount: src.reviewCount - monthsAgo * 25,
        capturedAt,
      })
    }
  }
  await db.reviewScore.createMany({ data: reviewRows })

  // 15. イベントと周辺の新規ホテル（外部需要動向 — 2026-10）。
  // 利用者が画面から登録した行（createdByUserId あり）は残し、デモの行だけを作り直す
  await db.event.deleteMany({ where: { hotelId, createdByUserId: null } })
  await db.event.createMany({
    data: [
      { name: '市民花火大会', type: 'festival', start: 9, end: 9, location: '河川敷', expectedImpact: 'high' },
      { name: '国際医学会', type: 'conference', start: 16, end: 18, location: '国際会議場', expectedImpact: 'high' },
      { name: 'アリーナ公演（2日間）', type: 'concert', start: 23, end: 24, location: '市営アリーナ', expectedImpact: 'medium' },
      { name: 'プロ野球 公式戦', type: 'sports', start: 30, end: 31, location: 'ドーム球場', expectedImpact: 'medium' },
      { name: '秋祭り', type: 'festival', start: 44, end: 45, location: '中心市街地', expectedImpact: 'low' },
    ].map(({ start, end, ...e }) => ({ ...e, hotelId, tenantId, startDate: addDays(today, start), endDate: addDays(today, end) })),
  })
  await db.newHotelOpening.deleteMany({ where: { hotelId, createdByUserId: null } })
  await db.newHotelOpening.createMany({
    data: [
      { name: 'ステーションホテル新館', days: 45, rooms: 220, category: 'ビジネス', location: '駅北口', distanceKm: 0.4, expectedImpact: 'high', notes: '同価格帯。開業月は割引販売の見込み' },
      { name: 'グランドリゾート湾岸', days: 150, rooms: 310, category: 'リゾート', location: '湾岸エリア', distanceKm: 3.2, expectedImpact: 'medium', notes: '上位カテゴリ。週末の需要を取り合う' },
      { name: 'カプセルイン中央', days: -40, rooms: 160, category: 'カプセル', location: '中央通り', distanceKm: 0.9, expectedImpact: 'low', notes: '開業済み。客層は重なりにくい' },
    ].map(({ days, ...h }) => ({ ...h, hotelId, tenantId, openingDate: addDays(today, days) })),
  })
}
