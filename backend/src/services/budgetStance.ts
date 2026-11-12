import { prisma } from '../lib/prisma.js'
import { monthRange } from '../lib/date.js'
import { otbAtLead, leadDaysBetween } from './forecast/pace.js'
import type { DayModel } from './forecast/dayType.js'

// 月の予算への向き合い方（D-13。先方の「需要予測手段（案）」(4)）。
//   onTrack = 着地見込みが予算に届いている（予算は気にせず日のタイプのモデルのまま）
//   chase   = 届いていないが、まだ追える（日の優先モデルを1段だけ稼働寄りにして室数を取りにいく）
//   giveUp  = 月初まで GIVE_UP_LEAD_DAYS 日を切って、足りない額が残りの伸びしろを超える
//             （「1か月前付近でその数値を追っても無理と判断した場合は予算未達を前提に最適な売上を目指す」— 予算は追わない）
// AI が日の予算を当て込めるのは3か月前からとする見立てに合わせ、月の初日が CHASE_HORIZON_DAYS 日より先の月は判定しない（null）。
// 判定に使う着地見込みは、日次バッチが保存した着地シミュレーション（前日までの見立て）。

export const CHASE_HORIZON_DAYS = 90
export const GIVE_UP_LEAD_DAYS = 30
/** 残りの見込み（まだ予約になっていない分）をどこまで上積みできると見るか */
export const STRETCH_RATIO = 0.2

export type BudgetStance = 'onTrack' | 'chase' | 'giveUp'

export interface BudgetStanceInput {
  /** 月の初日までの日数（月が始まっていれば 0 以下） */
  leadToMonthStart: number
  budgetRevenue: number | null
  projectedRevenue: number | null
  /** 確定・予約済みの売上（過ぎた日の実績＋先の日の予約室数×予測ADR） */
  onBooksRevenue: number
}

export interface BudgetStanceResult {
  stance: BudgetStance
  /** 予算 − 着地見込み（正なら不足） */
  gap: number
  /** まだ予約になっていない見込み × STRETCH_RATIO */
  stretch: number
}

export function decideBudgetStance(input: BudgetStanceInput): BudgetStanceResult | null {
  const { leadToMonthStart, budgetRevenue, projectedRevenue, onBooksRevenue } = input
  if (budgetRevenue == null || budgetRevenue <= 0 || projectedRevenue == null) return null
  if (leadToMonthStart > CHASE_HORIZON_DAYS) return null
  const gap = Math.round(budgetRevenue - projectedRevenue)
  const stretch = Math.round(Math.max(0, projectedRevenue - onBooksRevenue) * STRETCH_RATIO)
  if (gap <= 0) return { stance: 'onTrack', gap, stretch }
  if (leadToMonthStart <= GIVE_UP_LEAD_DAYS && gap > stretch) return { stance: 'giveUp', gap, stretch }
  return { stance: 'chase', gap, stretch }
}

/** 予算を追う月は、日の優先モデルを1段だけ稼働寄りにする（単価優先 → バランス → 稼働優先） */
export function modelForStance(model: DayModel | null, stance: BudgetStance | null | undefined): DayModel | null {
  if (stance !== 'chase' || model == null) return model
  return model === 'adr' ? 'balanced' : 'occupancy'
}

/** 対象の月ごとの向き合い方を読む。キーは "YYYY-M" */
export async function loadBudgetStances(
  hotelId: string,
  months: Array<{ year: number; month: number }>,
  today: Date
): Promise<Map<string, BudgetStanceResult>> {
  const result = new Map<string, BudgetStanceResult>()
  for (const { year, month } of months) {
    const { start, end } = monthRange(year, month)
    const leadToMonthStart = leadDaysBetween(today, start)
    if (leadToMonthStart > CHASE_HORIZON_DAYS || end <= today) continue
    const [budget, landing, actuals, recs, curves] = await Promise.all([
      prisma.monthlyBudget.findUnique({
        where: { hotelId_year_month: { hotelId, year, month } },
        select: { budgetRevenue: true, budgetRooms: true, budgetAdr: true },
      }),
      prisma.monthlyLandingSimulation.findUnique({
        where: { hotelId_year_month: { hotelId, year, month } },
        select: { projectedRevenue: true },
      }),
      prisma.dailyData.findMany({ where: { hotelId, date: { gte: start, lt: today } }, select: { totalRevenue: true } }),
      prisma.aiPriceRecommendation.findMany({
        where: { hotelId, roomTypeId: null, date: { gte: today > start ? today : start, lt: end } },
        select: { date: true, predictedAdr: true, recommendedPrice: true },
      }),
      prisma.bookingCurveData.findMany({
        where: { hotelId, stayDate: { gte: today > start ? today : start, lt: end } },
        select: { stayDate: true, daysBefore: true, roomsBooked: true },
      }),
    ])
    const budgetRevenue =
      budget?.budgetRevenue ?? (budget?.budgetRooms != null && budget.budgetAdr != null ? budget.budgetRooms * budget.budgetAdr : null)
    let onBooks = actuals.reduce((a, d) => a + (d.totalRevenue ?? 0), 0)
    for (const rec of recs) {
      const points = curves.filter((c) => c.stayDate.getTime() === rec.date.getTime())
      const otb = otbAtLead(points, Math.max(0, leadDaysBetween(today, rec.date)))
      const adr = rec.predictedAdr ?? rec.recommendedPrice ?? budget?.budgetAdr ?? null
      if (otb != null && adr != null) onBooks += otb * adr
    }
    const decided = decideBudgetStance({
      leadToMonthStart,
      budgetRevenue,
      projectedRevenue: landing?.projectedRevenue ?? null,
      onBooksRevenue: onBooks,
    })
    if (decided) result.set(`${year}-${month}`, decided)
  }
  return result
}

/** 期間に含まれる月の一覧 */
export function monthsBetween(start: Date, end: Date): Array<{ year: number; month: number }> {
  const months: Array<{ year: number; month: number }> = []
  for (let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); d <= end; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    months.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 })
  }
  return months
}
