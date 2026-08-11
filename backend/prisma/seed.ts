import {
  PrismaClient,
  UserRole,
  DemandLevel,
  AlertSeverity,
  SegmentKind,
  SpecialDayKind,
  type RateCategory,
} from '@prisma/client'
import bcrypt from 'bcryptjs'
import { RANK_CODES, PRICE_TABLE } from './priceTableSeedData.js'
import {
  SOURCE_SEGMENTS,
  CHANNEL_SEGMENTS,
  MARKET_SEGMENTS,
  REGION_SEGMENTS,
  type SegmentSeedItem,
} from './segmentMasterSeedData.js'

const prisma = new PrismaClient()

// 再実行しても同じ結果になるよう、決定的な擬似乱数を使う（M-4: 冪等性）
function createRng(seed: number) {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
}

const rng = createRng(20260704)

const TENANT_CODE = 'demo-tenant'
const HOTEL_ID = 'demo-hotel-001'

function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function addDays(d: Date, days: number): Date {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() + days)
  return r
}

async function main() {
  console.log('🌱 Seeding database...')

  // 1. Tenant
  const tenant = await prisma.tenant.upsert({
    where: { code: TENANT_CODE },
    update: {},
    create: {
      code: TENANT_CODE,
      name: 'デモテナント（藤田観光想定）',
    },
  })
  console.log(`✅ Tenant: ${tenant.name}`)

  // 2. Hotel
  const hotel = await prisma.hotel.upsert({
    where: { id: HOTEL_ID },
    // 既存レコードでもマスタ値（客室数等）が反映されるよう update にも渡す
    update: { tenantId: tenant.id, totalRooms: 970, weekendDays: [5, 6] },
    create: {
      id: HOTEL_ID,
      tenantId: tenant.id,
      name: 'デモホテル東京',
      address: '東京都千代田区丸の内1-1-1',
      phone: '03-1234-5678',
      email: 'info@demo-hotel.example.com',
      totalRooms: 970,
      weekendDays: [5, 6], // 金・土
    },
  })
  console.log(`✅ Hotel: ${hotel.name}`)

  // 3. Room types
  // Drive「新宿ワシントンデータ/マスタ設定.xlsx」の部屋タイプマスタ、
  // 客室数は同「◆HG2608残室.xlsx」の総数に合わせている（合計 = hotel.totalRooms）
  const roomTypes = [
    { code: 'DSN', name: 'スタンダードダブル（S）', capacity: 2, count: 26, sortOrder: 1 },
    { code: 'DMN', name: 'スタンダードダブル', capacity: 2, count: 576, sortOrder: 2 },
    { code: 'DGN', name: 'コンフォートダブル', capacity: 2, count: 27, sortOrder: 3 },
    { code: 'DXN', name: 'コンフォートダブル（X）', capacity: 2, count: 26, sortOrder: 4 },
    { code: 'TSN', name: 'スタンダードツイン（S）', capacity: 2, count: 16, sortOrder: 5 },
    { code: 'TMN', name: 'スタンダードツイン', capacity: 2, count: 224, sortOrder: 6 },
    { code: 'TGN', name: 'コンフォートダブルツイン', capacity: 2, count: 16, sortOrder: 7 },
    { code: 'TPN', name: 'スタンダードトリプル', capacity: 3, count: 16, sortOrder: 8 },
    { code: 'HCN', name: 'ユニバーサルツイン', capacity: 2, count: 1, sortOrder: 9 },
    { code: 'GDMN', name: 'スタンダードダブル（ゴジラフロア）', capacity: 2, count: 2, sortOrder: 10 },
    { code: 'GTSN', name: 'スタンダードツイン（ゴジラフロア・S）', capacity: 2, count: 2, sortOrder: 11 },
    { code: 'GTMN', name: 'スタンダードツイン（ゴジラフロア）', capacity: 2, count: 28, sortOrder: 12 },
    { code: 'GTPN', name: 'スタンダードトリプル（ゴジラフロア）', capacity: 3, count: 2, sortOrder: 13 },
    { code: 'GDN', name: 'ゴジラビューダブル', capacity: 2, count: 6, sortOrder: 14 },
    { code: 'GGN', name: 'ゴジラルーム', capacity: 2, count: 1, sortOrder: 15 },
    { code: 'GKN', name: 'キングギドラルーム', capacity: 2, count: 1, sortOrder: 16 },
  ]

  const roomTypeRecords = new Map<string, string>()
  for (const rt of roomTypes) {
    const record = await prisma.roomType.upsert({
      where: { hotelId_code: { hotelId: hotel.id, code: rt.code } },
      update: { tenantId: tenant.id, ...rt },
      create: { hotelId: hotel.id, tenantId: tenant.id, ...rt },
    })
    roomTypeRecords.set(rt.code, record.id)
  }
  // マスタに無い旧タイプ（STD_SINGLE 等）は無効化する
  await prisma.roomType.updateMany({
    where: { hotelId: hotel.id, code: { notIn: roomTypes.map((rt) => rt.code) } },
    data: { isActive: false },
  })
  console.log(`✅ Room types: ${roomTypes.length}`)

  // 4. 料金ランク（販売料金表 — 部屋タイプ × レート区分 × ランクコード71段階）
  // 旧「40段階・rank番号」構造は撤廃済み（docs/drive-gap-analysis.md §2.1）
  let priceRankCount = 0
  for (const [roomTypeCode, rates] of Object.entries(PRICE_TABLE)) {
    const roomTypeId = roomTypeRecords.get(roomTypeCode)
    // 料金表にあるがマスタに無いタイプ（SMN/GVN/GTGN）はスキップする
    if (!roomTypeId) continue

    for (const [rateCategory, prices] of Object.entries(rates)) {
      if (!prices) continue
      const rows = RANK_CODES.map((rankCode, sortOrder) => ({
        rankCode,
        sortOrder,
        price: prices[sortOrder],
      })).filter((r): r is { rankCode: string; sortOrder: number; price: number } => r.price != null)

      for (const row of rows) {
        await prisma.priceRank.upsert({
          where: {
            hotelId_roomTypeId_rateCategory_rankCode: {
              hotelId: hotel.id,
              roomTypeId,
              rateCategory: rateCategory as RateCategory,
              rankCode: row.rankCode,
            },
          },
          update: { sortOrder: row.sortOrder, price: row.price, tenantId: tenant.id },
          create: {
            hotelId: hotel.id,
            tenantId: tenant.id,
            roomTypeId,
            rateCategory: rateCategory as RateCategory,
            rankCode: row.rankCode,
            sortOrder: row.sortOrder,
            price: row.price,
          },
        })
        priceRankCount++
      }
    }
  }
  console.log(`✅ Price ranks: ${priceRankCount}（${RANK_CODES.length}段階 × 部屋タイプ × レート区分）`)

  // 5. Users（要件定義書 §4: ADMIN / MANAGER / OPERATOR）
  const hashedPassword = await bcrypt.hash('Admin1234', 12)
  const users = [
    { email: 'admin@demo-hotel.example.com', name: '管理者', role: UserRole.ADMIN },
    { email: 'manager@demo-hotel.example.com', name: 'レベニューマネージャー', role: UserRole.MANAGER },
    { email: 'operator@demo-hotel.example.com', name: 'フロント担当', role: UserRole.OPERATOR },
  ]
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { tenantId: tenant.id, hotelId: hotel.id, role: u.role },
      create: {
        ...u,
        password: hashedPassword,
        tenantId: tenant.id,
        hotelId: hotel.id,
      },
    })
  }
  console.log(`✅ Users: ${users.length} (password: Admin1234)`)

  // 6. 価格戦略の重み付け設定は 2026/8 に撤去（docs/drive-gap-analysis.md §3-3）

  // 7. Competitors（冪等にするため既存を削除して再作成）
  await prisma.competitor.deleteMany({ where: { hotelId: hotel.id } })
  const competitorRecords = []
  const competitors = [
    { name: '競合ホテルA', category: '同カテゴリ' },
    { name: '競合ホテルB', category: '同カテゴリ' },
    { name: '競合ホテルC', category: '上位カテゴリ' },
  ]
  for (const comp of competitors) {
    const rec = await prisma.competitor.create({
      data: {
        hotelId: hotel.id,
        tenantId: tenant.id,
        otaUrls: { rakuten: null, jalan: null, ikkyu: null, expedia: null, agoda: null },
        ...comp,
      },
    })
    competitorRecords.push(rec)
  }
  console.log(`✅ Competitors: ${competitors.length}`)

  // 8. 日別データ: 過去90日実績 + 今後90日AI予測
  const today = dateOnly(new Date())
  const totalRooms = 970

  await prisma.dailyData.deleteMany({ where: { hotelId: hotel.id } })
  await prisma.aiPriceRecommendation.deleteMany({ where: { hotelId: hotel.id } })
  await prisma.bookingCurveData.deleteMany({ where: { hotelId: hotel.id } })
  await prisma.competitorPriceData.deleteMany({ where: { tenantId: tenant.id } })

  // AI推奨ランクの基準はしご: 料金表が登録されている最初の部屋タイプ × 自社レート（価格の安い順）
  // マスタ先頭（DSN）は販売料金表に無いため、実在するタイプを探して使う
  const baseRankRows = await prisma.priceRank.findMany({
    where: { hotelId: hotel.id, rateCategory: 'OWN', isActive: true },
    orderBy: [{ roomType: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
    select: { rankCode: true, sortOrder: true, price: true, roomTypeId: true },
  })
  const baseRoomTypeId = baseRankRows[0]?.roomTypeId
  const baseLadder = baseRankRows.filter((r) => r.roomTypeId === baseRoomTypeId)

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
        hotelId: hotel.id,
        tenantId: tenant.id,
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
    // 推奨ランクは基準タイプ（マスタ先頭）の自社レートのはしごから選ぶ
    const rankIndex = Math.min(
      baseLadder.length - 1,
      Math.max(0, Math.round(predictedOcc * (baseLadder.length - 1)))
    )
    const pickedRank = baseLadder[rankIndex]
    aiRows.push({
      hotelId: hotel.id,
      tenantId: tenant.id,
      date,
      predictedOccupancy: Math.round(predictedOcc * 1000) / 1000,
      predictedAdr: Math.round((isWeekend ? 24000 : 17000) * seasonBoost),
      recommendedRank: pickedRank?.sortOrder ?? null,
      recommendedRankCode: pickedRank?.rankCode ?? null,
      recommendedPrice: pickedRank?.price ?? null,
      demandLevel,
      confidence: Math.round((0.7 + rng() * 0.25) * 100) / 100,
      modelVersion: 'seed-v1',
    })
  }
  await prisma.dailyData.createMany({ data: dailyRows })
  await prisma.aiPriceRecommendation.createMany({ data: aiRows })
  console.log(`✅ Daily data: ${dailyRows.length}, AI recommendations: ${aiRows.length}`)

  // 9. ブッキングカーブ（今後30日の宿泊日 × リードタイム）
  const curveRows = []
  for (let offset = 0; offset < 30; offset++) {
    const stayDate = addDays(today, offset)
    const dow = stayDate.getUTCDay()
    const isWeekend = dow === 5 || dow === 6
    const finalRooms = Math.round(totalRooms * (isWeekend ? 0.93 : 0.75))
    for (const daysBefore of [90, 60, 45, 30, 21, 14, 7, 3, 1, 0]) {
      if (daysBefore < offset) continue // まだ到来していない時点は積上げ済みのみ
      const progress = Math.pow(1 - daysBefore / 90, 1.6)
      curveRows.push({
        hotelId: hotel.id,
        tenantId: tenant.id,
        stayDate,
        daysBefore,
        roomsBooked: Math.round(finalRooms * Math.min(1, progress + rng() * 0.05)),
      })
    }
  }
  await prisma.bookingCurveData.createMany({ data: curveRows })
  console.log(`✅ Booking curve rows: ${curveRows.length}`)

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
        tenantId: tenant.id,
        date,
        price1P,
        price2P: Math.round((price1P * 1.8) / 100) * 100,
        price3P: Math.round((price1P * 2.4) / 100) * 100,
        dataSource: 'seed',
        reliability: 'medium',
      })
    }
  }
  await prisma.competitorPriceData.createMany({ data: compPriceRows })
  console.log(`✅ Competitor prices: ${compPriceRows.length}`)

  // 11. 月次予算（当月±3ヶ月）
  for (let m = -3; m <= 3; m++) {
    const target = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + m, 1))
    const year = target.getUTCFullYear()
    const month = target.getUTCMonth() + 1
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const budgetOccupancy = 0.78
    const budgetAdr = 18500
    const budgetRooms = Math.round(totalRooms * budgetOccupancy * daysInMonth)
    await prisma.monthlyBudget.upsert({
      where: { hotelId_year_month: { hotelId: hotel.id, year, month } },
      update: {},
      create: {
        hotelId: hotel.id,
        tenantId: tenant.id,
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
  console.log('✅ Monthly budgets: 7 months')

  // 12. アラート・AIコメント（デモ用）
  await prisma.alert.deleteMany({ where: { hotelId: hotel.id } })
  await prisma.alert.createMany({
    data: [
      {
        hotelId: hotel.id,
        tenantId: tenant.id,
        severity: AlertSeverity.RED,
        title: '稼働率が予算を大幅に下回っています',
        message: '来週火曜の予約積上が予算比 -18pt です。価格ランクの引き下げを検討してください。',
        linkTab: 'pricing',
        targetDate: addDays(today, 4),
      },
      {
        hotelId: hotel.id,
        tenantId: tenant.id,
        severity: AlertSeverity.YELLOW,
        title: '競合平均価格との乖離が拡大',
        message: '今週末の自社価格が競合平均より 12% 高くなっています。経過観察してください。',
        linkTab: 'daily',
        targetDate: addDays(today, 2),
      },
    ],
  })

  await prisma.aiComment.deleteMany({ where: { hotelId: hotel.id } })
  await prisma.aiComment.create({
    data: {
      hotelId: hotel.id,
      tenantId: tenant.id,
      section: 'dashboard-summary',
      content:
        '今月の稼働率は予算比 +2.1pt と好調に推移しています。週末（金・土）のADRは前年比 +6% で、' +
        '特に土曜日は満室に近い水準です。一方、平日火曜・水曜の稼働が予算を下回っており、' +
        '平日限定プランまたは料金ランク引き下げの検討を推奨します。',
      modelVersion: 'seed-v1',
    },
  })
  console.log('✅ Alerts & AI comments')

  // 13. 月間着地シミュレーション（当月）
  await prisma.monthlyLandingSimulation.upsert({
    where: {
      hotelId_year_month: {
        hotelId: hotel.id,
        year: today.getUTCFullYear(),
        month: today.getUTCMonth() + 1,
      },
    },
    update: {},
    create: {
      hotelId: hotel.id,
      tenantId: tenant.id,
      year: today.getUTCFullYear(),
      month: today.getUTCMonth() + 1,
      projectedOccupancy: 0.81,
      projectedAdr: 18900,
      projectedRevPar: 15300,
      projectedRooms: 4980,
      projectedRevenue: 4980 * 18900,
    },
  })
  console.log('✅ Landing simulation')

  // セグメントマスタ（F-SET-06 — Phase 4A。冪等: hotelId×kind×code でupsert）
  const segmentSeeds: Array<[SegmentKind, SegmentSeedItem[]]> = [
    [SegmentKind.SOURCE, SOURCE_SEGMENTS],
    [SegmentKind.CHANNEL, CHANNEL_SEGMENTS],
    [SegmentKind.MARKET, MARKET_SEGMENTS],
    [SegmentKind.REGION, REGION_SEGMENTS],
  ]
  let segmentCount = 0
  for (const [kind, items] of segmentSeeds) {
    for (const [index, item] of items.entries()) {
      await prisma.segmentMaster.upsert({
        where: { hotelId_kind_code: { hotelId: hotel.id, kind, code: item.code } },
        create: {
          tenantId: tenant.id,
          hotelId: hotel.id,
          kind,
          code: item.code,
          name: item.name,
          aggregateCode: item.aggregateCode ?? null,
          sortOrder: index,
        },
        update: {
          name: item.name,
          aggregateCode: item.aggregateCode ?? null,
          sortOrder: index,
        },
      })
      segmentCount++
    }
  }
  console.log(`✅ Segment masters: ${segmentCount}`)

  // 特日マスタ（F-DP-08）
  // 出典: Drive「ACCOMMOS共有資料/外部要因と旅行（宿泊）の関連付け.xlsx」の時間軸分類 a.特日
  // 期間が年をまたぐもの・年により動くもの（春節等）は当年分のみ生成する。
  const currentYear = today.getUTCFullYear()
  const specialDayDefs: Array<{ name: string; from: [number, number]; to: [number, number] }> = [
    { name: '年末年始', from: [12, 27], to: [12, 31] },
    { name: '年末年始', from: [1, 1], to: [1, 5] },
    { name: '正月明け', from: [1, 6], to: [1, 26] },
    { name: '受験', from: [1, 15], to: [2, 15] },
    { name: '中国春節', from: [1, 25], to: [2, 20] },
    { name: '春休み', from: [3, 15], to: [4, 7] },
    { name: 'ゴールデンウイーク', from: [4, 28], to: [5, 6] },
    { name: '夏休み', from: [7, 20], to: [8, 25] },
    { name: 'お盆', from: [8, 11], to: [8, 16] },
    { name: 'シルバーウィーク', from: [9, 20], to: [9, 26] },
  ]

  await prisma.specialDay.deleteMany({ where: { hotelId: hotel.id } })
  const specialDayRows: Array<{
    hotelId: string
    tenantId: string
    date: Date
    name: string
    kind: SpecialDayKind
    source: 'AI' | 'MANUAL'
  }> = []
  // 当年と翌年（カレンダーが翌年に伸びるため）
  for (const year of [currentYear, currentYear + 1]) {
    for (const def of specialDayDefs) {
      const start = new Date(Date.UTC(year, def.from[0] - 1, def.from[1]))
      const end = new Date(Date.UTC(year, def.to[0] - 1, def.to[1]))
      for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
        specialDayRows.push({
          hotelId: hotel.id,
          tenantId: tenant.id,
          date: new Date(d),
          name: def.name,
          kind: SpecialDayKind.TOKUJITSU,
          // 実運用ではAIが提示しオペレーターが修正する（同 §5.4）
          source: 'AI',
        })
      }
    }
  }
  await prisma.specialDay.createMany({ data: specialDayRows, skipDuplicates: true })
  console.log(`✅ Special days: ${specialDayRows.length}`)

  // 外部要因（F-EXT-01）: 起因 × 時間軸の代表例
  await prisma.externalFactor.deleteMany({ where: { hotelId: hotel.id } })
  const factorRows = [
    {
      category: 'EVENT' as const,
      timeAxis: 'PERIOD' as const,
      title: '桜開花（東京）',
      description: '例年3月下旬〜4月上旬。地域差あり、天候（②）からの作用を受ける',
      startDate: new Date(Date.UTC(currentYear + (today.getUTCMonth() >= 4 ? 1 : 0), 2, 20)),
      endDate: new Date(Date.UTC(currentYear + (today.getUTCMonth() >= 4 ? 1 : 0), 3, 10)),
      impactScore: 0.2,
      area: '首都圏',
    },
    {
      category: 'INBOUND' as const,
      timeAxis: 'PERIOD' as const,
      title: 'JNTO訪日外客数の増加傾向',
      description: '市場別統計より。インバウンドによるマーケット上昇',
      startDate: addDays(today, -30),
      endDate: addDays(today, 90),
      impactScore: 0.12,
      area: '全国',
    },
    {
      category: 'WEATHER' as const,
      timeAxis: 'PERIOD' as const,
      title: '台風シーズン',
      description: '8月〜11月。発生時は短期の予約変動・キャンセル増に注意',
      startDate: new Date(Date.UTC(currentYear, 7, 1)),
      endDate: new Date(Date.UTC(currentYear, 10, 30)),
      impactScore: -0.1,
      area: '全国',
    },
    {
      category: 'ECONOMY' as const,
      timeAxis: 'PERIOD' as const,
      title: '円安基調',
      description: '為替動向。インバウンド需要の後押し要因',
      startDate: addDays(today, -60),
      endDate: addDays(today, 120),
      impactScore: 0.08,
      area: '全国',
    },
    {
      category: 'ACCESS' as const,
      timeAxis: 'PERIOD' as const,
      title: '国際線の増便',
      description: '海外路線の便数増。③インバウンド動向と関連',
      startDate: addDays(today, -15),
      endDate: addDays(today, 180),
      impactScore: 0.06,
      area: '首都圏',
    },
  ]
  await prisma.externalFactor.createMany({
    data: factorRows.map((f) => ({ ...f, hotelId: hotel.id, tenantId: tenant.id, source: 'AI' as const })),
  })
  console.log(`✅ External factors: ${factorRows.length}`)

  // オンハンド・実績明細・残室（Phase 4B — F-OH-02/03, F-CXL-01, F-TOP-01, F-INV-01）
  // 冪等: ホテル単位で全削除してから再生成する
  await prisma.onHandSnapshot.deleteMany({ where: { hotelId: hotel.id } })
  await prisma.reservation.deleteMany({ where: { hotelId: hotel.id } })
  await prisma.reservationNight.deleteMany({ where: { hotelId: hotel.id } })
  await prisma.roomInventorySnapshot.deleteMany({ where: { hotelId: hotel.id } })

  const MARKET_CODES = ['IFJ', 'IAJ', 'NET', 'GAJ', 'BJ', 'IFF']
  const REGION_CODES = ['12TK', '14KN', '27NR', '29OS', '01HK', '40FO']
  const AGENT_CODES = ['RAK', 'JLN', 'EXP', 'AGD', 'JTB', 'DIR']
  const RATE_TYPES = ['OWN', 'MEMBER', 'OTA']

  // 実績明細（過去60日分。セグメント別分析・上位下位分析の元データ）
  const nightRows = []
  for (let offset = -60; offset < 0; offset++) {
    const stayDate = addDays(today, offset)
    const dow = stayDate.getUTCDay()
    const isWeekend = dow === 5 || dow === 6
    const daySold = Math.round(totalRooms * (isWeekend ? 0.92 : 0.74))
    // 1日を6セグメントに分配する
    let remaining = daySold
    for (let i = 0; i < MARKET_CODES.length; i++) {
      const isLast = i === MARKET_CODES.length - 1
      const rooms = isLast ? remaining : Math.max(1, Math.round(daySold * (0.3 - i * 0.045)))
      if (!isLast && rooms >= remaining) continue
      remaining -= isLast ? 0 : rooms
      const guestsPerRoom = 1 + Math.round(rng())
      const adrBase = isWeekend ? 21000 : 16500
      nightRows.push({
        hotelId: hotel.id,
        tenantId: tenant.id,
        stayDate,
        roomTypeCode: roomTypes[i % roomTypes.length].code,
        rateTypeCode: RATE_TYPES[i % RATE_TYPES.length],
        rooms,
        guests: rooms * guestsPerRoom,
        roomRevenue: Math.round(rooms * (adrBase + rng() * 3000)),
        agentCode: AGENT_CODES[i % AGENT_CODES.length],
        regionCode: REGION_CODES[i % REGION_CODES.length],
        marketCode: MARKET_CODES[i],
        individualGroupType: MARKET_CODES[i].startsWith('G') || MARKET_CODES[i] === 'BJ' ? 'G' : 'I',
        buildingCode: 'MAIN',
      })
      if (isLast) break
    }
  }
  await prisma.reservationNight.createMany({ data: nightRows })

  // オンハンド予約（今後180日分の断面 = 本日）＋キャンセル分析用の予約/キャンセル日
  const reservationRows = []
  for (let offset = 0; offset < 180; offset++) {
    const checkIn = addDays(today, offset)
    const dow = checkIn.getUTCDay()
    const isWeekend = dow === 5 || dow === 6
    // 先の日付ほど積上が薄い（ブッキングカーブの形になる）
    const pickup = Math.max(0.05, 1 - offset / 200)
    const targetRooms = Math.round(totalRooms * (isWeekend ? 0.93 : 0.75) * pickup)
    const bookingCount = Math.max(1, Math.round(targetRooms / 8))
    for (let b = 0; b < bookingCount; b++) {
      const rooms = Math.max(1, Math.round(targetRooms / bookingCount))
      const leadDays = Math.round(10 + rng() * 120)
      const nights = 1 + Math.round(rng() * 2)
      const marketCode = MARKET_CODES[b % MARKET_CODES.length]
      // 約8%をキャンセル済みにする（キャンセル分析の元データ）
      const isCancelled = rng() < 0.08
      reservationRows.push({
        hotelId: hotel.id,
        tenantId: tenant.id,
        capturedDate: today,
        bookedAt: addDays(checkIn, -leadDays),
        cancelledAt: isCancelled ? addDays(checkIn, -Math.round(rng() * leadDays)) : null,
        checkIn,
        checkOut: addDays(checkIn, nights),
        roomTypeCode: roomTypes[b % roomTypes.length].code,
        rateTypeCode: RATE_TYPES[b % RATE_TYPES.length],
        rooms,
        guests: rooms * (1 + Math.round(rng())),
        roomRevenue: Math.round(rooms * nights * ((isWeekend ? 21000 : 16500) + rng() * 3000)),
        agentCode: AGENT_CODES[b % AGENT_CODES.length],
        regionCode: REGION_CODES[b % REGION_CODES.length],
        marketCode,
        isGroup: marketCode === 'GAJ' || marketCode === 'BJ',
      })
    }
  }
  await prisma.reservation.createMany({ data: reservationRows })

  // オンハンドスナップショット
  // 実運用（PMS取込アプリ）は「毎日、その時点の全宿泊日分」を送るため、
  // seedも取得日ごとに対象宿泊日を横断して作る（取得日が揃っていないと
  // 月間ブッキングカーブが正しい形にならない）。取得日は過去540日を10日刻み。
  const snapshotRows = []
  for (let capturedOffset = -540; capturedOffset <= 0; capturedOffset += 10) {
    const capturedDate = addDays(today, capturedOffset)
    // その断面から先360日分の宿泊日を積み上げる
    for (let stayOffset = 0; stayOffset <= 360; stayOffset += 1) {
      const stayDate = addDays(capturedDate, stayOffset)
      const dayDiff = Math.round((stayDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
      // 直近60日前〜先360日を対象。加えて前年同時期（カーブの前年対比用）も残す
      const isCurrentWindow = dayDiff >= -60
      const isLastYearWindow = dayDiff <= -305 && dayDiff >= -425
      if (!isCurrentWindow && !isLastYearWindow) continue
      const dow = stayDate.getUTCDay()
      const isWeekend = dow === 5 || dow === 6
      const finalRooms = Math.round(totalRooms * (isWeekend ? 0.93 : 0.75))
      const daysBefore = stayOffset
      const progress = Math.pow(1 - Math.min(1, daysBefore / 360), 2.2)
      const rooms = Math.round(finalRooms * Math.min(1, progress + rng() * 0.03))
      if (rooms <= 0) continue
      snapshotRows.push({
        hotelId: hotel.id,
        tenantId: tenant.id,
        stayDate,
        capturedDate,
        rooms,
        revenue: Math.round(rooms * ((isWeekend ? 21000 : 16500) + rng() * 2000)),
        guests: rooms * 2,
      })
    }
  }
  // 件数が多いためチャンク分割して投入する
  for (let i = 0; i < snapshotRows.length; i += 5000) {
    await prisma.onHandSnapshot.createMany({
      data: snapshotRows.slice(i, i + 5000),
      skipDuplicates: true,
    })
  }

  // 残室スナップショット（直近2断面 × 今後30日 × タイプ別 — 前回差異を出せるようにする）
  const inventoryRows = []
  for (const capturedOffset of [-1, 0]) {
    const capturedDate = addDays(today, capturedOffset)
    for (let stayOffset = 0; stayOffset < 30; stayOffset++) {
      const stayDate = addDays(today, stayOffset)
      const dow = stayDate.getUTCDay()
      const isWeekend = dow === 5 || dow === 6
      for (const rt of roomTypes) {
        const soldRatio = (isWeekend ? 0.9 : 0.7) + capturedOffset * -0.02 + rng() * 0.06
        const remaining = Math.max(0, Math.round(rt.count * (1 - Math.min(1, soldRatio))))
        inventoryRows.push({
          hotelId: hotel.id,
          tenantId: tenant.id,
          roomTypeCode: rt.code,
          stayDate,
          capturedDate,
          remainingRooms: remaining,
          totalRooms: rt.count,
        })
      }
    }
  }
  await prisma.roomInventorySnapshot.createMany({ data: inventoryRows, skipDuplicates: true })

  console.log(
    `✅ On-hand: reservations ${reservationRows.length}, nights ${nightRows.length}, ` +
      `snapshots ${snapshotRows.length}, inventory ${inventoryRows.length}`
  )

  console.log('✨ Seeding completed!')
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
