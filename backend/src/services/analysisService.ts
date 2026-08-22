import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'
import type { CreateReviewScoreInput } from '../lib/validators.js'

/**
 * 年間推移 — 月単位（F-ANA-03: クォーターではなく月単位）
 */
export async function getMonthlyTrendService(hotelId: string, year: number) {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const start = new Date(Date.UTC(year, 0, 1))
  const end = new Date(Date.UTC(year + 1, 0, 1))

  const dailyData = await prisma.dailyData.findMany({
    where: { hotelId, date: { gte: start, lt: end }, totalRevenue: { not: null } },
    orderBy: { date: 'asc' },
  })

  const budgets = await prisma.monthlyBudget.findMany({
    where: { hotelId, year },
  })
  const budgetByMonth = new Map(budgets.map((b) => [b.month, b]))

  const months = []
  for (let month = 1; month <= 12; month++) {
    const rows = dailyData.filter((d) => d.date.getUTCMonth() + 1 === month)
    const revenue = rows.reduce((sum, d) => sum + (d.totalRevenue ?? 0), 0)
    const soldRooms = rows.reduce((sum, d) => sum + (d.soldRooms ?? 0), 0)
    const guests = rows.reduce((sum, d) => sum + (d.guests ?? 0), 0)
    const roomNights = hotel.totalRooms * rows.length
    const budget = budgetByMonth.get(month)

    months.push({
      month,
      revenue: Math.round(revenue),
      soldRooms,
      guests,
      adr: soldRooms > 0 ? Math.round(revenue / soldRooms) : null,
      occupancy: roomNights > 0 ? Math.round((soldRooms / roomNights) * 1000) / 1000 : null,
      revPar: roomNights > 0 ? Math.round(revenue / roomNights) : null,
      budgetRevenue: budget?.budgetRevenue ?? null,
      lastYearRevenue: budget?.lastYearRevenue ?? null,
      hasActuals: rows.length > 0,
    })
  }

  return { hotelId, year, months }
}

/**
 * 競合分析（F-ANA-02: "平均"ではなくホテル別の販売価格として集計）
 */
export async function getCompetitorAnalysisService(
  hotelId: string,
  startDate: Date,
  endDate: Date
) {
  const competitors = await prisma.competitor.findMany({
    where: { hotelId, isActive: true },
    include: {
      priceData: {
        where: { date: { gte: startDate, lte: endDate } },
      },
    },
  })

  return {
    hotelId,
    startDate: startDate.toISOString().slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10),
    competitors: competitors.map((c) => {
      const prices = c.priceData.map((p) => p.price1P).filter((p): p is number => p != null)
      return {
        id: c.id,
        name: c.name,
        category: c.category,
        sampleSize: prices.length,
        minPrice: prices.length > 0 ? Math.min(...prices) : null,
        maxPrice: prices.length > 0 ? Math.max(...prices) : null,
        avgPrice:
          prices.length > 0
            ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
            : null,
      }
    }),
  }
}

/**
 * 口コミ評価点（F-ANA-04）
 */
export async function getReviewScoresService(hotelId: string) {
  return prisma.reviewScore.findMany({
    where: { hotelId },
    orderBy: { capturedAt: 'desc' },
    take: 50,
  })
}

/**
 * 口コミ評価点の手動登録（レピュテーション管理。スクレイピング自動取得はPhase 4）
 */
export async function createReviewScoreService(input: CreateReviewScoreInput) {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  return prisma.reviewScore.create({
    data: { ...input, tenantId: hotel.tenantId },
  })
}

/**
 * 口コミ評価点の削除（誤登録の取り消し用）
 */
export async function deleteReviewScoreService(id: string, hotelId: string) {
  // hotelId 条件を含めることでテナント越え削除を防ぐ
  const result = await prisma.reviewScore.deleteMany({ where: { id, hotelId } })
  if (result.count === 0) throw new NotFoundError('口コミ評価点')
}

/**
 * OTAチャネル別実績の集計（チャネル別サマリー＋日別内訳）。
 * データソースは現在 seed / Excel取込。OTAサイトからの自動取得はPhase 4（未実装）。
 */
export async function getOtaChannelSummaryService(hotelId: string, year: number, month: number) {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 1))

  const rows = await prisma.otaChannelData.findMany({
    where: { hotelId, date: { gte: start, lt: end } },
    orderBy: { date: 'asc' },
  })

  const byChannel = new Map<
    string,
    { roomsSold: number; revenue: number; campaignDays: number; days: number }
  >()
  for (const r of rows) {
    const agg = byChannel.get(r.channel) ?? { roomsSold: 0, revenue: 0, campaignDays: 0, days: 0 }
    agg.roomsSold += r.roomsSold ?? 0
    agg.revenue += r.revenue ?? 0
    if (r.campaignFlag) agg.campaignDays += 1
    agg.days += 1
    byChannel.set(r.channel, agg)
  }

  const totalRooms = [...byChannel.values()].reduce((sum, c) => sum + c.roomsSold, 0)
  const totalRevenue = [...byChannel.values()].reduce((sum, c) => sum + c.revenue, 0)

  const channels = [...byChannel.entries()]
    .map(([channel, agg]) => ({
      channel,
      roomsSold: agg.roomsSold,
      revenue: Math.round(agg.revenue),
      adr: agg.roomsSold > 0 ? Math.round(agg.revenue / agg.roomsSold) : null,
      roomsShare: totalRooms > 0 ? Math.round((agg.roomsSold / totalRooms) * 1000) / 1000 : null,
      revenueShare: totalRevenue > 0 ? Math.round((agg.revenue / totalRevenue) * 1000) / 1000 : null,
      campaignDays: agg.campaignDays,
    }))
    .sort((a, b) => b.roomsSold - a.roomsSold)

  // 日別内訳（チャネル別積み上げグラフ用）
  const daily = rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    channel: r.channel,
    roomsSold: r.roomsSold ?? 0,
    revenue: r.revenue != null ? Math.round(r.revenue) : null,
    adr: r.adr != null ? Math.round(r.adr) : null,
    campaignFlag: r.campaignFlag,
  }))

  return {
    hotelId,
    year,
    month,
    totals: {
      roomsSold: totalRooms,
      revenue: Math.round(totalRevenue),
      adr: totalRooms > 0 ? Math.round(totalRevenue / totalRooms) : null,
    },
    channels,
    daily,
  }
}

/**
 * 当月着地予測（着地遷移 — F-DP-04）。
 * 実績済みの日は実績、未実績の日はAI予測（AiPriceRecommendation）で埋めて
 * 月末着地を算出し、日別の累計トラジェクトリ（実績・着地見込み・予算ペース）を返す。
 * 算出した着地は MonthlyLandingSimulation にも反映する。
 */
export async function getLandingForecastService(hotelId: string, year: number, month: number) {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 1))
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()

  const [actuals, predictions, budget] = await Promise.all([
    prisma.dailyData.findMany({
      where: { hotelId, date: { gte: start, lt: end } },
      orderBy: { date: 'asc' },
    }),
    prisma.aiPriceRecommendation.findMany({
      where: { hotelId, roomTypeId: null, date: { gte: start, lt: end } },
      orderBy: { date: 'asc' },
    }),
    prisma.monthlyBudget.findUnique({
      where: { hotelId_year_month: { hotelId, year, month } },
    }),
  ])

  const actualByDay = new Map(actuals.map((d) => [d.date.getUTCDate(), d]))
  const predictionByDay = new Map(predictions.map((p) => [p.date.getUTCDate(), p]))

  let cumActualRevenue = 0
  let cumProjectedRevenue = 0
  let projectedRooms = 0
  let actualRooms = 0
  let actualRevenue = 0
  let actualDays = 0
  let forecastDays = 0

  const budgetRevenue = budget?.budgetRevenue ?? null
  const trajectory = []

  for (let day = 1; day <= daysInMonth; day++) {
    const actual = actualByDay.get(day)
    const prediction = predictionByDay.get(day)
    const hasActual = actual?.totalRevenue != null || actual?.soldRooms != null

    let dayRevenue: number | null = null
    let dayRooms: number | null = null
    let source: 'actual' | 'forecast' | 'none' = 'none'

    if (hasActual) {
      dayRooms = actual?.soldRooms ?? null
      dayRevenue =
        actual?.totalRevenue ??
        (actual?.adr != null && actual?.soldRooms != null ? actual.adr * actual.soldRooms : null)
      source = 'actual'
      actualDays += 1
    } else if (prediction?.predictedOccupancy != null) {
      dayRooms = Math.round(prediction.predictedOccupancy * hotel.totalRooms)
      const adr = prediction.predictedAdr ?? prediction.recommendedPrice ?? null
      dayRevenue = adr != null ? Math.round(dayRooms * adr) : null
      source = 'forecast'
      forecastDays += 1
    }

    if (dayRevenue != null) cumProjectedRevenue += dayRevenue
    if (dayRooms != null) projectedRooms += dayRooms
    if (source === 'actual') {
      cumActualRevenue += dayRevenue ?? 0
      actualRevenue += dayRevenue ?? 0
      actualRooms += dayRooms ?? 0
    }

    trajectory.push({
      date: new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10),
      source,
      dayRevenue: dayRevenue != null ? Math.round(dayRevenue) : null,
      cumActualRevenue: source === 'actual' ? Math.round(cumActualRevenue) : null,
      cumProjectedRevenue: Math.round(cumProjectedRevenue),
      cumBudgetRevenue:
        budgetRevenue != null ? Math.round((budgetRevenue / daysInMonth) * day) : null,
    })
  }

  const roomNights = hotel.totalRooms * daysInMonth
  const projectedRevenue = Math.round(cumProjectedRevenue)
  const projectedAdr = projectedRooms > 0 ? Math.round(projectedRevenue / projectedRooms) : null
  const projectedOccupancy =
    roomNights > 0 ? Math.round((projectedRooms / roomNights) * 1000) / 1000 : null
  const projectedRevPar = roomNights > 0 ? Math.round(projectedRevenue / roomNights) : null

  // 算出した着地をシミュレーションテーブルへ反映（他画面と共通のデータソースにする）
  await prisma.monthlyLandingSimulation.upsert({
    where: { hotelId_year_month: { hotelId, year, month } },
    update: {
      projectedRevenue,
      projectedAdr,
      projectedOccupancy,
      projectedRevPar,
      projectedRooms,
      computedAt: new Date(),
    },
    create: {
      hotelId,
      tenantId: hotel.tenantId,
      year,
      month,
      projectedRevenue,
      projectedAdr,
      projectedOccupancy,
      projectedRevPar,
      projectedRooms,
    },
  })

  return {
    hotelId,
    year,
    month,
    daysInMonth,
    actualDays,
    forecastDays,
    actualToDate: {
      revenue: Math.round(actualRevenue),
      rooms: actualRooms,
      adr: actualRooms > 0 ? Math.round(actualRevenue / actualRooms) : null,
    },
    landing: {
      projectedRevenue,
      projectedRooms,
      projectedAdr,
      projectedOccupancy,
      projectedRevPar,
    },
    budget: {
      budgetRevenue,
      budgetOccupancy: budget?.budgetOccupancy ?? null,
      budgetAdr: budget?.budgetAdr ?? null,
      revenueRatio:
        budgetRevenue != null && budgetRevenue > 0
          ? Math.round((projectedRevenue / budgetRevenue) * 1000) / 1000
          : null,
    },
    trajectory,
  }
}
