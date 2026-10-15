import { prisma } from '../lib/prisma.js'
import { BadRequestError, NotFoundError } from '../middlewares/errorHandler.js'
import { todayJst } from '../lib/date.js'
import { ruleBasedForecaster } from './forecast/ruleBasedForecaster.js'
import { isInRanges, lastYearSameWeekday } from './forecast/pace.js'

// 販売開始チェック（D-11）。
// IDeaS を使うホテルでは、先々（約11か月先）の月を販売開始する前に、人が「前年同月以上の ADR」を想定し、
// システムの初期提示額と突き合わせて「システムの金額が想定以上ならリスクなし」と判断している。
// ここではその突き合わせを自動で行う: 対象月の推奨（保存しない試算）を、前年同曜日の実績 ADR・前年同月の ADR・予算 ADR と比べ、
// 前年を割る日を一覧にする。
//
// 比べる値は予測 ADR（料金ランクから見た客室単価の見込み）。実績 ADR が無いホテルでは 1名料金で代用する。

export type SaleOpenDayStatus = 'ok' | 'below_last_year' | 'no_comparison'

export interface SaleOpenCheckDay {
  date: string
  weekday: number
  demandLevel: string
  recommendedRank: number | null
  recommendedPrice: number | null
  predictedAdr: number | null
  /** 前年同曜日（364日前） */
  lastYearDate: string
  lastYearAdr: number | null
  lastYearOccupancy: number | null
  /** 推奨（予測ADR）の前年同曜日比（%）。比べられなければ null */
  diffPct: number | null
  status: SaleOpenDayStatus
  /** その日のイベント名（特殊日を含む） */
  events: string[]
}

export interface SaleOpenCheckResult {
  year: number
  month: number
  days: SaleOpenCheckDay[]
  summary: {
    /** 推奨の予測ADRの月平均 */
    averagePredictedAdr: number | null
    /** 前年同月の ADR（予算表の前年実績、無ければ日次実績から） */
    lastYearMonthAdr: number | null
    budgetAdr: number | null
    comparableDays: number
    belowLastYearDays: number
    /** ok = 前年以上（販売開始のリスク小）、review = 前年割れの日がある、insufficient = 前年の実績が足りず判断できない */
    verdict: 'ok' | 'review' | 'insufficient'
  }
  modelVersion: string
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const round = (v: number | null) => (v == null ? null : Math.round(v))

/** 1日ぶんの判定（純関数） */
export function judgeSaleOpenDay(value: number | null, lastYearAdr: number | null): { diffPct: number | null; status: SaleOpenDayStatus } {
  if (value == null || lastYearAdr == null || lastYearAdr <= 0) return { diffPct: null, status: 'no_comparison' }
  const diffPct = Math.round((value / lastYearAdr - 1) * 1000) / 10
  return { diffPct, status: value < lastYearAdr ? 'below_last_year' : 'ok' }
}

/** 月の判定（純関数）。比べられる日が半分未満なら判断しない */
export function judgeSaleOpenMonth(params: {
  totalDays: number
  comparableDays: number
  belowLastYearDays: number
  averagePredictedAdr: number | null
  lastYearMonthAdr: number | null
}): SaleOpenCheckResult['summary']['verdict'] {
  const { totalDays, comparableDays, belowLastYearDays, averagePredictedAdr, lastYearMonthAdr } = params
  if (comparableDays * 2 < totalDays) return 'insufficient'
  if (belowLastYearDays > 0) return 'review'
  if (averagePredictedAdr != null && lastYearMonthAdr != null && averagePredictedAdr < lastYearMonthAdr) return 'review'
  return 'ok'
}

export async function getSaleOpenCheckService(hotelId: string, year: number, month: number): Promise<SaleOpenCheckResult> {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, isActive: true }, select: { id: true } })
  if (!hotel) throw new NotFoundError('ホテル')

  const first = new Date(Date.UTC(year, month - 1, 1))
  const last = new Date(Date.UTC(year, month, 0))
  const today = todayJst()
  if (last < today) throw new BadRequestError('過去の月は確認できません。今月以降を指定してください')
  // 今月なら今日以降だけを試算する
  const start = first < today ? today : first

  const lastYearMonthFirst = new Date(Date.UTC(year - 1, month - 1, 1))
  const lastYearMonthLast = new Date(Date.UTC(year - 1, month, 0))
  const lastYearStart = lastYearSameWeekday(start)
  const lastYearEnd = lastYearSameWeekday(last)
  const rangeStart = lastYearStart < lastYearMonthFirst ? lastYearStart : lastYearMonthFirst
  const rangeEnd = lastYearEnd > lastYearMonthLast ? lastYearEnd : lastYearMonthLast

  const [forecasts, lastYearDaily, budget, events] = await Promise.all([
    // 保存しない試算（料金カレンダーの推奨は変えない）
    ruleBasedForecaster.forecast({ hotelId, startDate: start, endDate: last }),
    prisma.dailyData.findMany({
      where: { hotelId, date: { gte: rangeStart, lte: rangeEnd } },
      select: { date: true, adr: true, occupancy: true, soldRooms: true, totalRevenue: true },
    }),
    prisma.monthlyBudget.findUnique({
      where: { hotelId_year_month: { hotelId, year, month } },
      select: { budgetAdr: true, lastYearAdr: true },
    }),
    prisma.event.findMany({
      where: {
        hotelId,
        OR: [
          { startDate: { lte: last }, endDate: { gte: start } },
          { excludeFromHistory: true, startDate: { lte: lastYearEnd }, endDate: { gte: lastYearStart } },
        ],
      },
      select: { name: true, startDate: true, endDate: true, excludeFromHistory: true },
    }),
  ])

  const specialDays = events.filter((e) => e.excludeFromHistory)
  const lastYearByDate = new Map(lastYearDaily.map((d) => [d.date.getTime(), d]))

  const days: SaleOpenCheckDay[] = forecasts.map((f) => {
    const lastYearDate = lastYearSameWeekday(f.date)
    // 前年同曜日が特殊日なら比べない（年末年始などは比べても意味がない）
    const lastYear = isInRanges(lastYearDate, specialDays) ? undefined : lastYearByDate.get(lastYearDate.getTime())
    const value = f.predictedAdr ?? f.recommendedPrice
    const judged = judgeSaleOpenDay(value, lastYear?.adr ?? null)
    return {
      date: iso(f.date),
      weekday: f.date.getUTCDay(),
      demandLevel: f.demandLevel,
      recommendedRank: f.recommendedRank,
      recommendedPrice: f.recommendedPrice,
      predictedAdr: round(f.predictedAdr),
      lastYearDate: iso(lastYearDate),
      lastYearAdr: round(lastYear?.adr ?? null),
      lastYearOccupancy: lastYear?.occupancy ?? null,
      ...judged,
      events: events.filter((e) => e.startDate <= f.date && f.date <= e.endDate).map((e) => e.name),
    }
  })

  // 前年同月の ADR: 予算表の前年実績を優先し、無ければ日次実績（売上 ÷ 販売室数）から出す
  const lastYearMonth = lastYearDaily.filter((d) => d.date >= lastYearMonthFirst && d.date <= lastYearMonthLast)
  const revenue = lastYearMonth.reduce((sum, d) => sum + (d.totalRevenue ?? 0), 0)
  const rooms = lastYearMonth.reduce((sum, d) => sum + (d.soldRooms ?? 0), 0)
  const lastYearMonthAdr = budget?.lastYearAdr ?? (rooms > 0 ? revenue / rooms : null)

  const values = forecasts.map((f) => f.predictedAdr ?? f.recommendedPrice).filter((v): v is number => v != null)
  const averagePredictedAdr = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null
  const comparableDays = days.filter((d) => d.status !== 'no_comparison').length
  const belowLastYearDays = days.filter((d) => d.status === 'below_last_year').length

  return {
    year,
    month,
    days,
    summary: {
      averagePredictedAdr: round(averagePredictedAdr),
      lastYearMonthAdr: round(lastYearMonthAdr),
      budgetAdr: round(budget?.budgetAdr ?? null),
      comparableDays,
      belowLastYearDays,
      verdict: judgeSaleOpenMonth({
        totalDays: days.length,
        comparableDays,
        belowLastYearDays,
        averagePredictedAdr,
        lastYearMonthAdr,
      }),
    },
    modelVersion: ruleBasedForecaster.name,
  }
}
