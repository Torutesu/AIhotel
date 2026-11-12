import { prisma } from '../lib/prisma.js'
import { allocateDailyBudgetWithFixed, type DailyBudget, type MonthBudgetInput } from './budgetAllocation.js'
import { addUtcDays, eachUtcDay, monthRange, todayJst } from '../lib/date.js'
import { isInRanges, lastYearSameWeekday, type BookingCurvePoint } from './forecast/pace.js'

// 月の「日ごとの比較の材料」をまとめて読む（2026-10 デモ画面の修正）。
// 料金カレンダー（予算・オンハンド・日のタイプ）、日別パフォーマンス（予算差異・前年比）、
// ブッキングカーブ（予算ADR・参考カーブ）で同じ読み方をするために一か所にまとめる。
//   - 日割り予算: 日別の予算を登録した日はその値（D-13）。残りの日には月次予算の残りを配る。
//     月の初日が AI_DAILY_BUDGET_DAYS 日以内なら AI の予測売上（予測稼働×予測ADR）の比、それより先は前年同曜日の販売室数の比
//     （先方の見立て: AI が日の予算を当て込めるのは3か月前からが現実的）
//   - 前年: 前年同曜日（364日前）。前年同曜日が特殊日（Event.excludeFromHistory）なら比べない
//   - 予約積上: 対象月の宿泊日と、その前年同曜日の宿泊日のもの

export interface LastYearDay {
  date: Date
  soldRooms: number | null
  occupancy: number | null
  adr: number | null
  revPar: number | null
  totalRevenue: number | null
}

/** AI の予測で日の予算を配る範囲（月の初日が今日からこの日数以内の月） */
export const AI_DAILY_BUDGET_DAYS = 90

/** 日の予算の出どころ。imported = 日別の予算を登録、ai = AI の予測の比、lastYear = 前年同曜日の比 */
export type DailyBudgetSource = 'imported' | 'ai' | 'lastYear'

export interface MonthContext {
  days: Date[]
  /** 月次予算（登録が無ければ null） */
  monthBudget: MonthBudgetInput | null
  /** days と同じ並び */
  budgets: DailyBudget[]
  /** days と同じ並び。予算が無い日は null */
  budgetSources: Array<DailyBudgetSource | null>
  /** 宿泊日（getTime）→ 予約積上 */
  curves: Map<number, BookingCurvePoint[]>
  /** 前年同曜日の宿泊日（getTime）→ 予約積上。特殊日は含めない */
  lastYearCurves: Map<number, BookingCurvePoint[]>
  /** 前年同曜日の日付（getTime）→ 実績。特殊日は含めない */
  lastYearDaily: Map<number, LastYearDay>
}

function groupCurves(rows: Array<{ stayDate: Date; daysBefore: number; roomsBooked: number }>) {
  const map = new Map<number, BookingCurvePoint[]>()
  for (const row of rows) {
    const key = row.stayDate.getTime()
    const list = map.get(key) ?? []
    list.push(row)
    map.set(key, list)
  }
  return map
}

/**
 * @param options.curves 読む予約積上。'all' = 月の全宿泊日（既定）、'none' = 読まない、Date[] = その宿泊日だけ。
 *   予約積上は毎日取り込むと1宿泊日あたり最大数百行になるため、使わない画面では読まない
 * @param options.lastYearCurves 前年同曜日の予約積上も読むか（既定 true）。今年の分だけ使う画面は false
 */
export async function loadMonthContext(
  hotelId: string,
  totalRooms: number,
  year: number,
  month: number,
  options: { curves?: 'all' | 'none' | Date[]; lastYearCurves?: boolean } = {}
): Promise<MonthContext> {
  const { start, end } = monthRange(year, month)
  const days = eachUtcDay(start, end)
  const lastYearStart = lastYearSameWeekday(start)
  const lastYearEnd = lastYearSameWeekday(days[days.length - 1])
  const curves = options.curves ?? 'all'
  const curveFilter = (from: Date, to: Date, stayDates: Date[] | null) =>
    stayDates ? { stayDate: { in: stayDates } } : { stayDate: { gte: from, lte: to } }
  const ownStayDates = Array.isArray(curves) ? curves : null
  const lastYearStayDates = ownStayDates ? ownStayDates.map(lastYearSameWeekday) : null

  const useAi = start <= addUtcDays(todayJst(), AI_DAILY_BUDGET_DAYS)
  const [budget, lastYearRows, specialDays, curveRows, lastYearCurveRows, dailyBudgets, recommendations] = await Promise.all([
    prisma.monthlyBudget.findUnique({
      where: { hotelId_year_month: { hotelId, year, month } },
      select: { budgetRevenue: true, budgetRooms: true, budgetAdr: true, budgetOccupancy: true },
    }),
    prisma.dailyData.findMany({
      where: { hotelId, date: { gte: lastYearStart, lte: lastYearEnd } },
      select: { date: true, soldRooms: true, occupancy: true, adr: true, revPar: true, totalRevenue: true },
    }),
    prisma.event.findMany({
      where: { hotelId, excludeFromHistory: true, startDate: { lte: lastYearEnd }, endDate: { gte: lastYearStart } },
      select: { startDate: true, endDate: true },
    }),
    curves === 'none'
      ? Promise.resolve([])
      : prisma.bookingCurveData.findMany({
          where: { hotelId, ...curveFilter(start, days[days.length - 1], ownStayDates) },
          select: { stayDate: true, daysBefore: true, roomsBooked: true },
        }),
    curves === 'none' || options.lastYearCurves === false
      ? Promise.resolve([])
      : prisma.bookingCurveData.findMany({
          where: { hotelId, ...curveFilter(lastYearStart, lastYearEnd, lastYearStayDates) },
          select: { stayDate: true, daysBefore: true, roomsBooked: true },
        }),
    prisma.dailyBudget.findMany({
      where: { hotelId, date: { gte: start, lte: days[days.length - 1] } },
      select: { date: true, budgetRooms: true, budgetRevenue: true },
    }),
    useAi
      ? prisma.aiPriceRecommendation.findMany({
          where: { hotelId, roomTypeId: null, date: { gte: start, lte: days[days.length - 1] } },
          select: { date: true, predictedOccupancy: true, predictedAdr: true, recommendedPrice: true },
        })
      : Promise.resolve([]),
  ])

  const special = (date: Date) => isInRanges(date, specialDays)
  const lastYearDaily = new Map(lastYearRows.filter((r) => !special(r.date)).map((r) => [r.date.getTime(), r]))
  const lastYearCurves = groupCurves(lastYearCurveRows.filter((r) => !special(r.stayDate)))

  const fixedByDate = new Map(dailyBudgets.map((b) => [b.date.getTime(), { rooms: b.budgetRooms, revenue: b.budgetRevenue }]))
  const recByDate = new Map(recommendations.map((r) => [r.date.getTime(), r]))
  // AI の予測売上の重み。予測が揃っていない月（予測の範囲外など）は前年同曜日に戻す
  const aiWeights = days.map((day) => {
    const rec = recByDate.get(day.getTime())
    const adr = rec?.predictedAdr ?? rec?.recommendedPrice ?? null
    return rec?.predictedOccupancy != null && adr != null ? rec.predictedOccupancy * adr : null
  })
  const aiUsable = useAi && aiWeights.filter((w) => w != null).length >= Math.ceil(days.length * 0.8)
  const weights = aiUsable ? aiWeights : days.map((day) => lastYearDaily.get(lastYearSameWeekday(day).getTime())?.soldRooms ?? null)
  const fixed = days.map((day) => fixedByDate.get(day.getTime()) ?? null)
  const budgets = allocateDailyBudgetWithFixed(budget, totalRooms, weights, fixed)
  const budgetSources = days.map((_, i): DailyBudgetSource | null => {
    if (fixed[i]) return 'imported'
    if (!budget) return null
    return aiUsable ? 'ai' : 'lastYear'
  })

  return { days, monthBudget: budget, budgets, budgetSources, curves: groupCurves(curveRows), lastYearCurves, lastYearDaily }
}
