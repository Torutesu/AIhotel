import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'

function monthRange(year: number, month: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  }
}

/** 実績集計の入力（DailyDataのうちKPI算出に使う項目のみ） */
export interface ActualDayRecord {
  totalRevenue: number | null
  soldRooms: number | null
  guests: number | null
}

/**
 * 実績KPIの集計（F-DASH-01）。
 * DOR = 宿泊人数 / 販売室数（1室あたり平均利用人数。要件定義書「14. 用語集」準拠）
 */
export function computeSummary(actualDays: ActualDayRecord[], totalRooms: number) {
  const totalRevenue = actualDays.reduce((sum, d) => sum + (d.totalRevenue ?? 0), 0)
  const soldRooms = actualDays.reduce((sum, d) => sum + (d.soldRooms ?? 0), 0)
  const guests = actualDays.reduce((sum, d) => sum + (d.guests ?? 0), 0)
  const roomNights = totalRooms * actualDays.length
  const adr = soldRooms > 0 ? totalRevenue / soldRooms : 0
  const occupancyRate = roomNights > 0 ? soldRooms / roomNights : 0
  const revPar = roomNights > 0 ? totalRevenue / roomNights : 0

  return {
    roomRevenue: Math.round(totalRevenue),
    soldRooms,
    adr: Math.round(adr),
    occupancyRate: Math.round(occupancyRate * 1000) / 1000,
    revPar: Math.round(revPar),
    guests,
    dor: soldRooms > 0 ? Math.round((guests / soldRooms) * 100) / 100 : 0,
    guestUnitPrice: guests > 0 ? Math.round(totalRevenue / guests) : 0,
    actualDays: actualDays.length,
  }
}

/**
 * 月別KPI（F-DASH-01/02）
 * 実績集計 + 予算比・前年比 + 日別推移（実績と AI 予測の連続系列 — F-DASH-03）
 */
export async function getDashboardKpiService(hotelId: string, year: number, month: number) {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const { start, end } = monthRange(year, month)

  const [dailyData, budget, recommendations, simulation] = await Promise.all([
    prisma.dailyData.findMany({
      where: { hotelId, date: { gte: start, lt: end } },
      orderBy: { date: 'asc' },
    }),
    prisma.monthlyBudget.findUnique({
      where: { hotelId_year_month: { hotelId, year, month } },
    }),
    prisma.aiPriceRecommendation.findMany({
      where: { hotelId, date: { gte: start, lt: end }, roomTypeId: null },
      orderBy: { date: 'asc' },
    }),
    prisma.monthlyLandingSimulation.findUnique({
      where: { hotelId_year_month: { hotelId, year, month } },
    }),
  ])

  // 実績集計（データが存在する日 = 本日までの実績）
  const actualDays = dailyData.filter((d) => d.totalRevenue != null)
  const summary = computeSummary(actualDays, hotel.totalRooms)
  const totalRevenue = summary.roomRevenue

  // 予算・前年比較（F-DASH-02）: 経過日数按分で「本日まで」の比率を出す
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const elapsedRatio = actualDays.length / daysInMonth

  const comparison = budget
    ? {
        budgetRevenue: budget.budgetRevenue,
        budgetRevenueToDate: budget.budgetRevenue != null ? Math.round(budget.budgetRevenue * elapsedRatio) : null,
        budgetRatioToDate:
          budget.budgetRevenue && budget.budgetRevenue > 0
            ? Math.round((totalRevenue / (budget.budgetRevenue * elapsedRatio)) * 1000) / 1000
            : null,
        budgetAdr: budget.budgetAdr,
        budgetOccupancy: budget.budgetOccupancy,
        lastYearRevenue: budget.lastYearRevenue,
        lastYearRatio:
          budget.lastYearRevenue && budget.lastYearRevenue > 0
            ? Math.round((totalRevenue / (budget.lastYearRevenue * elapsedRatio)) * 1000) / 1000
            : null,
        lastYearAdr: budget.lastYearAdr,
        lastYearOccupancy: budget.lastYearOccupancy,
      }
    : null

  // 日別推移: 実績 + AI予測（実績のない未来日は予測値 — F-DASH-03）
  const recommendationByDate = new Map(
    recommendations.map((r) => [r.date.toISOString().slice(0, 10), r])
  )
  const actualByDate = new Map(dailyData.map((d) => [d.date.toISOString().slice(0, 10), d]))

  const dailyTrend = []
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(Date.UTC(year, month - 1, day))
    const key = date.toISOString().slice(0, 10)
    const actual = actualByDate.get(key)
    const rec = recommendationByDate.get(key)
    dailyTrend.push({
      date: key,
      occupancy: actual?.occupancy ?? null,
      adr: actual?.adr ?? null,
      predictedOccupancy: rec?.predictedOccupancy ?? null,
      predictedAdr: rec?.predictedAdr ?? null,
      isActual: actual?.totalRevenue != null,
    })
  }

  return { hotelId, year, month, summary, comparison, dailyTrend, simulation }
}

/**
 * KPI比較（月初比較・日付比較 — F-DASH-04）
 */
export async function getKpiComparisonService(
  hotelId: string,
  year: number,
  month: number,
  baseDate?: Date
) {
  const snapshots = await prisma.kpiSnapshot.findMany({
    where: {
      hotelId,
      targetYear: year,
      targetMonth: month,
      ...(baseDate && { snapshotDate: baseDate }),
    },
    orderBy: { snapshotDate: 'asc' },
  })
  return snapshots
}

/**
 * アラート一覧（F-DASH-05）
 */
export async function getAlertsService(hotelId: string) {
  return prisma.alert.findMany({
    where: { hotelId, status: { not: 'RESOLVED' } },
    orderBy: [{ severity: 'asc' }, { detectedAt: 'desc' }],
  })
}

/**
 * AIまとめ（F-DASH-06）: 最新のセクション別コメント
 */
export async function getAiSummaryService(hotelId: string, section = 'dashboard-summary') {
  return prisma.aiComment.findFirst({
    where: { hotelId, section },
    orderBy: { generatedAt: 'desc' },
  })
}
