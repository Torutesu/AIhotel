import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'

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
