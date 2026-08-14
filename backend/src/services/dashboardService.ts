import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'

function monthRange(year: number, month: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  }
}

/**
 * 年度の開始月（4月始まり）。
 * TODO: テナント／ホテル単位で変更可能にする場合は Hotel の設定項目へ移す。
 */
export const FISCAL_YEAR_START_MONTH = 4

/** 実績集計の入力（DailyDataのうちKPI算出に使う項目のみ） */
export interface ActualDayRecord {
  totalRevenue: number | null
  soldRooms: number | null
  guests: number | null
}

/** 予算・前年実績（MonthlyBudgetのうち比較に使う項目のみ） */
export interface BudgetRecord {
  budgetRevenue: number | null
  budgetRooms: number | null
  budgetAdr: number | null
  budgetOccupancy: number | null
  lastYearRevenue: number | null
  lastYearRooms: number | null
  lastYearAdr: number | null
  lastYearOccupancy: number | null
}

/** 比較対象（予算または前年実績）の集計値 */
export interface ComparisonTarget {
  revenue: number | null
  adr: number | null
  occupancy: number | null
}

/** 実績側の集計値（比率算出に使う最小項目） */
export interface ActualAggregate {
  revenue: number
  adr: number
  occupancy: number
}

/** 1軸ぶんの比較結果（対予算・対前年の比率と、比較に使った目標値） */
export interface ComparisonAxis {
  budgetRevenue: number | null
  budgetRevenueRatio: number | null
  budgetAdr: number | null
  budgetAdrRatio: number | null
  budgetOccupancy: number | null
  budgetOccupancyRatio: number | null
  lastYearRevenue: number | null
  lastYearRevenueRatio: number | null
  lastYearAdr: number | null
  lastYearAdrRatio: number | null
  lastYearOccupancy: number | null
  lastYearOccupancyRatio: number | null
}

/** 実績÷目標。目標が未設定/0なら null（小数第3位まで） */
export function ratio(actual: number | null, target: number | null): number | null {
  if (actual == null || target == null || target === 0) return null
  return Math.round((actual / target) * 1000) / 1000
}

/**
 * 実績と比較対象（予算・前年）から1軸ぶんの比較結果を作る。
 * 売上は期間合計どうし、ADR・稼働率は「率」なので按分せず実績値と目標値を直接比較する。
 */
export function buildComparisonAxis(
  actual: ActualAggregate,
  budget: ComparisonTarget,
  lastYear: ComparisonTarget
): ComparisonAxis {
  return {
    budgetRevenue: budget.revenue,
    budgetRevenueRatio: ratio(actual.revenue, budget.revenue),
    budgetAdr: budget.adr,
    budgetAdrRatio: ratio(actual.adr, budget.adr),
    budgetOccupancy: budget.occupancy,
    budgetOccupancyRatio: ratio(actual.occupancy, budget.occupancy),
    lastYearRevenue: lastYear.revenue,
    lastYearRevenueRatio: ratio(actual.revenue, lastYear.revenue),
    lastYearAdr: lastYear.adr,
    lastYearAdrRatio: ratio(actual.adr, lastYear.adr),
    lastYearOccupancy: lastYear.occupancy,
    lastYearOccupancyRatio: ratio(actual.occupancy, lastYear.occupancy),
  }
}

/**
 * 指定年月が属する年度の開始年月を返す（FISCAL_YEAR_START_MONTH 始まり）。
 * 例: 2026年3月は2025年度 → { year: 2025, month: 4 }
 */
export function fiscalYearStart(
  year: number,
  month: number,
  startMonth = FISCAL_YEAR_START_MONTH
): { year: number; month: number } {
  return { year: month >= startMonth ? year : year - 1, month: startMonth }
}

/**
 * 複数月の予算レコードを年度累計の比較対象に畳み込む。
 * ADRは売上÷室数の加重平均、稼働率は室数÷（客室数×期間日数）で再計算する。
 */
export function aggregateBudgets(
  budgets: BudgetRecord[],
  totalRooms: number,
  periodDays: number
): { budget: ComparisonTarget; lastYear: ComparisonTarget } {
  const sum = (pick: (b: BudgetRecord) => number | null): number | null => {
    const values = budgets.map(pick).filter((v): v is number => v != null)
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null
  }

  const roomNights = totalRooms * periodDays
  const budgetRevenue = sum((b) => b.budgetRevenue)
  const budgetRooms = sum((b) => b.budgetRooms)
  const lastYearRevenue = sum((b) => b.lastYearRevenue)
  const lastYearRooms = sum((b) => b.lastYearRooms)

  return {
    budget: {
      revenue: budgetRevenue,
      adr: budgetRevenue != null && budgetRooms ? Math.round(budgetRevenue / budgetRooms) : null,
      occupancy:
        budgetRooms != null && roomNights > 0 ? Math.round((budgetRooms / roomNights) * 1000) / 1000 : null,
    },
    lastYear: {
      revenue: lastYearRevenue,
      adr:
        lastYearRevenue != null && lastYearRooms ? Math.round(lastYearRevenue / lastYearRooms) : null,
      occupancy:
        lastYearRooms != null && roomNights > 0
          ? Math.round((lastYearRooms / roomNights) * 1000) / 1000
          : null,
    },
  }
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

  // 年度累計（F-DASH-02 第3軸）: 年度開始月から当月末までを集計対象にする
  const fiscalStart = fiscalYearStart(year, month)
  const fiscalStartDate = new Date(Date.UTC(fiscalStart.year, fiscalStart.month - 1, 1))

  // 前年同月（グラフに前年実績カーブを重ねるため — F-DASH-03）
  const lastYearRange = monthRange(year - 1, month)

  const [
    dailyData,
    budget,
    recommendations,
    simulation,
    fiscalDailyData,
    fiscalBudgets,
    lastYearDailyData,
  ] = await Promise.all([
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
      prisma.dailyData.findMany({
        where: { hotelId, date: { gte: fiscalStartDate, lt: end } },
        orderBy: { date: 'asc' },
      }),
      prisma.monthlyBudget.findMany({
        where: {
          hotelId,
          OR: [
            { year: fiscalStart.year, month: { gte: fiscalStart.month } },
            ...(fiscalStart.year < year ? [{ year, month: { lte: month } }] : []),
          ],
        },
      }),
      prisma.dailyData.findMany({
        where: { hotelId, date: { gte: lastYearRange.start, lt: lastYearRange.end } },
        orderBy: { date: 'asc' },
      }),
    ])

  // 実績集計（データが存在する日 = 本日までの実績）
  const actualDays = dailyData.filter((d) => d.totalRevenue != null)
  const summary = computeSummary(actualDays, hotel.totalRooms)

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const elapsedRatio = actualDays.length / daysInMonth

  // 予算・前年比較（F-DASH-02）: 「本日まで」「累計進捗」「年度累計」の3軸
  const monthActual: ActualAggregate = {
    revenue: summary.roomRevenue,
    adr: summary.adr,
    occupancy: summary.occupancyRate,
  }

  const comparison = (() => {
    // 当月の予算・前年（月次レコード。未登録なら各値 null）
    const monthBudget: ComparisonTarget = {
      revenue: budget?.budgetRevenue ?? null,
      adr: budget?.budgetAdr ?? null,
      occupancy: budget?.budgetOccupancy ?? null,
    }
    const monthLastYear: ComparisonTarget = {
      revenue: budget?.lastYearRevenue ?? null,
      adr: budget?.lastYearAdr ?? null,
      occupancy: budget?.lastYearOccupancy ?? null,
    }

    // 本日まで: 売上目標のみ経過日数で按分（ADR・稼働率は率なので按分しない）
    const prorate = (value: number | null): number | null =>
      value != null ? Math.round(value * elapsedRatio) : null
    const toDate = buildComparisonAxis(
      monthActual,
      { ...monthBudget, revenue: prorate(monthBudget.revenue) },
      { ...monthLastYear, revenue: prorate(monthLastYear.revenue) }
    )

    // 累計進捗: 月間予算フルに対する到達率
    const cumulative = buildComparisonAxis(monthActual, monthBudget, monthLastYear)

    // 年度累計: 年度開始月から当月実績までの累計どうしを比較
    const fiscalActualDays = fiscalDailyData.filter((d) => d.totalRevenue != null)
    const fiscalSummary = computeSummary(fiscalActualDays, hotel.totalRooms)
    const fiscalTargets = aggregateBudgets(fiscalBudgets, hotel.totalRooms, fiscalActualDays.length)
    const fiscalYear = buildComparisonAxis(
      {
        revenue: fiscalSummary.roomRevenue,
        adr: fiscalSummary.adr,
        occupancy: fiscalSummary.occupancyRate,
      },
      fiscalTargets.budget,
      fiscalTargets.lastYear
    )

    return {
      // 既存フィールド（後方互換のため維持）
      budgetRevenue: budget?.budgetRevenue ?? null,
      budgetRevenueToDate: toDate.budgetRevenue,
      budgetRatioToDate: toDate.budgetRevenueRatio,
      budgetAdr: budget?.budgetAdr ?? null,
      budgetOccupancy: budget?.budgetOccupancy ?? null,
      lastYearRevenue: budget?.lastYearRevenue ?? null,
      lastYearRatio: toDate.lastYearRevenueRatio,
      lastYearAdr: budget?.lastYearAdr ?? null,
      lastYearOccupancy: budget?.lastYearOccupancy ?? null,
      // 3軸（F-DASH-02）
      toDate,
      cumulative,
      fiscalYear,
      fiscalYearLabel: `${fiscalStart.year}年度（${fiscalStart.month}月〜${month}月）`,
      actualSummary: {
        fiscalRevenue: fiscalSummary.roomRevenue,
        fiscalAdr: fiscalSummary.adr,
        fiscalOccupancy: fiscalSummary.occupancyRate,
        fiscalActualDays: fiscalSummary.actualDays,
      },
    }
  })()

  // 日別推移: 実績 + AI予測（実績のない未来日は予測値）+ 前年同月実績 — F-DASH-03
  const recommendationByDate = new Map(
    recommendations.map((r) => [r.date.toISOString().slice(0, 10), r])
  )
  const actualByDate = new Map(dailyData.map((d) => [d.date.toISOString().slice(0, 10), d]))
  // 前年は「同じ日付（日）」で対応付ける（曜日ではなく日で揃える）
  const lastYearByDay = new Map(
    lastYearDailyData.map((d) => [d.date.getUTCDate(), d])
  )

  const dailyTrend = []
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(Date.UTC(year, month - 1, day))
    const key = date.toISOString().slice(0, 10)
    const actual = actualByDate.get(key)
    const rec = recommendationByDate.get(key)
    const lastYear = lastYearByDay.get(day)
    dailyTrend.push({
      date: key,
      occupancy: actual?.occupancy ?? null,
      adr: actual?.adr ?? null,
      predictedOccupancy: rec?.predictedOccupancy ?? null,
      predictedAdr: rec?.predictedAdr ?? null,
      lastYearOccupancy: lastYear?.occupancy ?? null,
      lastYearAdr: lastYear?.adr ?? null,
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
 * 重要度は1〜5の5段階。ダッシュボードは minLevel=4 を渡し Level 5・4 のみ表示する。
 */
export async function getAlertsService(hotelId: string, minLevel?: number) {
  return prisma.alert.findMany({
    where: {
      hotelId,
      status: { not: 'RESOLVED' },
      ...(minLevel != null && { level: { gte: minLevel } }),
    },
    orderBy: [{ level: 'desc' }, { detectedAt: 'desc' }],
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
