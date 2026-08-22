import { PrismaClient, UserRole, DemandLevel, AlertSeverity } from '@prisma/client'
import bcrypt from 'bcryptjs'

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
const PRICE_RANK_COUNT = 40 // F-SET-02: 最大40段階

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
    update: { tenantId: tenant.id },
    create: {
      id: HOTEL_ID,
      tenantId: tenant.id,
      name: 'デモホテル東京',
      address: '東京都千代田区丸の内1-1-1',
      phone: '03-1234-5678',
      email: 'info@demo-hotel.example.com',
      totalRooms: 200,
      weekendDays: [5, 6], // 金・土
    },
  })
  console.log(`✅ Hotel: ${hotel.name}`)

  // 3. Room types
  const roomTypes = [
    { code: 'STD_SINGLE', name: 'スタンダードシングル', capacity: 1, count: 80, sortOrder: 1 },
    { code: 'STD_DOUBLE', name: 'スタンダードダブル', capacity: 2, count: 40, sortOrder: 2 },
    { code: 'MOD_TWIN', name: 'モデレートツイン', capacity: 2, count: 50, sortOrder: 3 },
    { code: 'DLX_TWIN', name: 'デラックスツイン', capacity: 2, count: 20, sortOrder: 4 },
    { code: 'TRIPLE', name: 'トリプル', capacity: 3, count: 10, sortOrder: 5 },
  ]

  for (const rt of roomTypes) {
    await prisma.roomType.upsert({
      where: { hotelId_code: { hotelId: hotel.id, code: rt.code } },
      update: { tenantId: tenant.id },
      create: { hotelId: hotel.id, tenantId: tenant.id, ...rt },
    })
  }
  console.log(`✅ Room types: ${roomTypes.length}`)

  // 4. Price ranks (40段階)
  for (let i = 1; i <= PRICE_RANK_COUNT; i++) {
    const ratio = (i - 1) / (PRICE_RANK_COUNT - 1)
    const base1P = Math.round(6500 + ratio * 23500) // 6,500 ~ 30,000
    await prisma.priceRank.upsert({
      where: { hotelId_rank: { hotelId: hotel.id, rank: i } },
      update: { tenantId: tenant.id },
      create: {
        hotelId: hotel.id,
        tenantId: tenant.id,
        rank: i,
        label: `R${String(i).padStart(2, '0')}`,
        price1P: base1P,
        price2P: Math.round(base1P * 1.4),
        price3P: Math.round(base1P * 1.8),
      },
    })
  }
  console.log(`✅ Price ranks: ${PRICE_RANK_COUNT}`)

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

  // 6. Pricing strategy config
  await prisma.pricingStrategyConfig.upsert({
    where: { hotelId: hotel.id },
    update: {},
    create: {
      hotelId: hotel.id,
      tenantId: tenant.id,
      weightOccupancy: 40,
      weightAdr: 40,
      weightCompetitor: 20,
    },
  })
  console.log('✅ Pricing strategy config')

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
  const totalRooms = 200

  await prisma.dailyData.deleteMany({ where: { hotelId: hotel.id } })
  await prisma.aiPriceRecommendation.deleteMany({ where: { hotelId: hotel.id } })
  await prisma.bookingCurveData.deleteMany({ where: { hotelId: hotel.id } })
  await prisma.competitorPriceData.deleteMany({ where: { tenantId: tenant.id } })

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
    const recommendedRank = Math.min(
      PRICE_RANK_COUNT,
      Math.max(1, Math.round(predictedOcc * PRICE_RANK_COUNT))
    )
    aiRows.push({
      hotelId: hotel.id,
      tenantId: tenant.id,
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
      // Level 5: 即時対応（ダッシュボード表示対象）
      {
        hotelId: hotel.id,
        tenantId: tenant.id,
        severity: AlertSeverity.RED,
        level: 5,
        title: '稼働率が予算を大幅に下回っています',
        message: '来週火曜の予約積上が予算比 -18pt です。価格ランクの引き下げを検討してください。',
        linkTab: 'pricing',
        targetDate: addDays(today, 4),
      },
      // Level 4: 1週間内の経過観察（ダッシュボード表示対象）
      {
        hotelId: hotel.id,
        tenantId: tenant.id,
        severity: AlertSeverity.YELLOW,
        level: 4,
        title: '競合価格との乖離が拡大',
        message: '今週末の自社価格が競合水準より 12% 高くなっています。経過観察してください。',
        linkTab: 'daily',
        targetDate: addDays(today, 2),
      },
      // Level 3以下: ダッシュボードには表示せず、各分析画面で確認する想定
      {
        hotelId: hotel.id,
        tenantId: tenant.id,
        severity: AlertSeverity.YELLOW,
        level: 3,
        title: 'OTA別の予約構成比に変化',
        message: '公式サイト経由の構成比が前月比 -4pt です。チャネル分析で推移を確認してください。',
        linkTab: 'analysis',
        targetDate: addDays(today, 7),
      },
      {
        hotelId: hotel.id,
        tenantId: tenant.id,
        severity: AlertSeverity.YELLOW,
        level: 2,
        title: '翌月の予算未登録',
        message: '翌月の予算データが未登録です。設定画面から登録してください。',
        linkTab: 'settings',
        targetDate: null,
      },
      {
        hotelId: hotel.id,
        tenantId: tenant.id,
        severity: AlertSeverity.YELLOW,
        level: 1,
        title: '料金ランクの見直し推奨',
        message: '直近30日で未使用の料金ランクが3件あります。マスタ整理を検討してください。',
        linkTab: 'settings',
        targetDate: null,
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

  // 14. 予測モデル設定（year=0 はホテルのデフォルト設定）
  await prisma.forecastModelConfig.upsert({
    where: { hotelId_year: { hotelId: hotel.id, year: 0 } },
    update: {},
    create: {
      hotelId: hotel.id,
      tenantId: tenant.id,
      year: 0,
      notes: 'デフォルト設定（組み込み値と同一）',
    },
  })
  console.log('✅ Forecast model config')

  // 15. 故障部屋（冪等にするため既存を削除して再作成）
  await prisma.outOfOrderRoom.deleteMany({ where: { hotelId: hotel.id } })
  await prisma.outOfOrderRoom.create({
    data: {
      hotelId: hotel.id,
      tenantId: tenant.id,
      startDate: addDays(today, 3),
      endDate: addDays(today, 10),
      rooms: 2,
      reason: '空調設備の修繕',
    },
  })
  console.log('✅ Out of order rooms')

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
