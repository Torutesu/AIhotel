import { PrismaClient, UserRole, DemandLevel, AlertSeverity, SegmentKind } from '@prisma/client'
import bcrypt from 'bcryptjs'
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

  // オンハンドスナップショット: 複数断面（過去360日分を10日刻み）でカーブを描けるようにする
  const snapshotRows = []
  for (let stayOffset = 0; stayOffset < 60; stayOffset++) {
    const stayDate = addDays(today, stayOffset)
    const dow = stayDate.getUTCDay()
    const isWeekend = dow === 5 || dow === 6
    const finalRooms = Math.round(totalRooms * (isWeekend ? 0.93 : 0.75))
    for (let daysBefore = 360; daysBefore >= 0; daysBefore -= 10) {
      const capturedDate = addDays(stayDate, -daysBefore)
      // 本日より後の断面はまだ存在しない
      if (capturedDate.getTime() > today.getTime()) continue
      const progress = Math.pow(1 - daysBefore / 360, 2.2)
      const rooms = Math.round(finalRooms * Math.min(1, progress + rng() * 0.03))
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
  await prisma.onHandSnapshot.createMany({ data: snapshotRows, skipDuplicates: true })

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
