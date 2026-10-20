import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'
import { DEFAULT_WEEKEND_DAYS, eachUtcDay, monthRange, todayJst } from '../lib/date.js'
import { loadMonthContext } from './dayContextService.js'
import { loadDayTypeModel } from './dayTypeService.js'
import { buildDayTypeTimeline, type DayModel } from './forecast/dayType.js'
import { lastYearSameWeekday, leadDaysBetween, otbAtLead } from './forecast/pace.js'

// 曜日別・日のタイプ別パフォーマンス（2026-10 の画面修正 PDF c分析01実績推移2）。
// 「前月以前は実績値、当月以降は実績値＋予約数」「表示項目は日別パフォーマンスと同様に販売室数〜前年比」
// 「日のタイプ別は曜日別と同じ内容で、曜日の項目に日タイプ名。クリックすると対象日を表示」に合わせ、
// 結果の出た日は実績、まだの日は今の予約室数（OTB）で数える。予約の単価・売上は PMS 連携後のため、ADR・売上は実績の日だけで出す。

export interface PerformanceDay {
  date: Date
  /** 実績（結果の出た日） */
  soldRooms: number | null
  revenue: number | null
  /** 今の予約室数（結果の出ていない日） */
  onHandRooms: number | null
}

export interface PerformanceLastYear {
  date: Date
  soldRooms: number | null
  revenue: number | null
}

export interface PerformanceRow {
  /** 数えた日数（実績か予約の記録がある日） */
  days: number
  /** うち結果の出た日 */
  actualDays: number
  /** 販売室数 = 実績＋予約 */
  soldRooms: number
  /** うち予約（結果の出ていない日の今の予約室数） */
  onHandRooms: number
  /** 室料売上（結果の出た日だけ） */
  revenue: number
  /** 稼働率 = 販売室数 ÷（客室数 × 日数） */
  occupancy: number | null
  /** ADR = 実績の日の 売上 ÷ 販売室数 */
  adr: number | null
  /** REV-Per = 実績の日の 売上 ÷（客室数 × 実績の日数） */
  revPar: number | null
  /** 前年同曜日（364日前）の実績の合計（比べられる日だけ） */
  lastYear: { days: number; soldRooms: number; revenue: number; occupancy: number | null; adr: number | null } | null
  /** 対象の日（"yyyy-MM-dd"） */
  dates: string[]
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const round3 = (v: number) => Math.round(v * 1000) / 1000

/** 日の集まりを集計する（純関数） */
export function aggregatePerformance(
  days: PerformanceDay[],
  lastYear: Map<number, PerformanceLastYear>,
  totalRooms: number
): PerformanceRow {
  const counted = days.filter((d) => d.soldRooms != null || d.onHandRooms != null)
  const actual = counted.filter((d) => d.soldRooms != null)
  const actualRooms = actual.reduce((a, d) => a + (d.soldRooms ?? 0), 0)
  const onHandRooms = counted.filter((d) => d.soldRooms == null).reduce((a, d) => a + (d.onHandRooms ?? 0), 0)
  const revenue = actual.reduce((a, d) => a + (d.revenue ?? 0), 0)
  const soldRooms = actualRooms + onHandRooms
  const capacity = totalRooms * counted.length

  const ly = counted.map((d) => lastYear.get(lastYearSameWeekday(d.date).getTime())).filter((v): v is PerformanceLastYear => v != null && v.soldRooms != null)
  const lyRooms = ly.reduce((a, d) => a + (d.soldRooms ?? 0), 0)
  const lyRevenue = ly.reduce((a, d) => a + (d.revenue ?? 0), 0)

  return {
    days: counted.length,
    actualDays: actual.length,
    soldRooms,
    onHandRooms,
    revenue: Math.round(revenue),
    occupancy: capacity > 0 ? round3(soldRooms / capacity) : null,
    adr: actualRooms > 0 ? Math.round(revenue / actualRooms) : null,
    revPar: totalRooms > 0 && actual.length > 0 ? Math.round(revenue / (totalRooms * actual.length)) : null,
    lastYear:
      ly.length > 0
        ? {
            days: ly.length,
            soldRooms: lyRooms,
            revenue: Math.round(lyRevenue),
            occupancy: totalRooms > 0 ? round3(lyRooms / (totalRooms * ly.length)) : null,
            adr: lyRooms > 0 ? Math.round(lyRevenue / lyRooms) : null,
          }
        : null,
    dates: counted.map((d) => iso(d.date)),
  }
}

/** 月の日ごとの実績・今の予約室数・前年同曜日の実績を読む */
async function loadMonthPerformanceDays(hotelId: string, year: number, month: number) {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, isActive: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  const totalRooms = hotel.totalRooms
  const today = todayJst()
  const { start, end } = monthRange(year, month)
  const allDays = eachUtcDay(start, end)
  const future = allDays.filter((d) => d >= today)

  const [context, actuals, recommendations] = await Promise.all([
    loadMonthContext(hotelId, totalRooms, year, month, { curves: future }),
    prisma.dailyData.findMany({
      where: { hotelId, date: { gte: start, lt: end } },
      select: { date: true, soldRooms: true, totalRevenue: true },
    }),
    prisma.aiPriceRecommendation.findMany({
      where: { hotelId, roomTypeId: null, date: { gte: start, lt: end } },
      select: { date: true, predictedOccupancy: true },
    }),
  ])
  const actualByDate = new Map(actuals.map((a) => [a.date.getTime(), a]))
  const days: PerformanceDay[] = allDays.map((date) => {
    const actual = actualByDate.get(date.getTime())
    const lead = leadDaysBetween(today, date)
    return {
      date,
      soldRooms: actual?.soldRooms ?? null,
      revenue: actual?.totalRevenue ?? null,
      onHandRooms: actual?.soldRooms == null && lead >= 0 ? otbAtLead(context.curves.get(date.getTime()) ?? [], lead) : null,
    }
  })
  const lastYear = new Map<number, PerformanceLastYear>(
    [...context.lastYearDaily.values()].map((d) => [d.date.getTime(), { date: d.date, soldRooms: d.soldRooms, revenue: d.totalRevenue }])
  )
  const predictedByDate = new Map(recommendations.map((r) => [r.date.getTime(), r.predictedOccupancy]))
  return { hotel, totalRooms, today, days, lastYear, curves: context.curves, predictedByDate }
}

/** 曜日別（0=日〜6=土）。週末は Hotel.weekendDays で判定する */
export async function getDayOfWeekBreakdownService(hotelId: string, year: number, month: number) {
  const { hotel, totalRooms, days, lastYear } = await loadMonthPerformanceDays(hotelId, year, month)
  const weekendDays = Array.isArray(hotel.weekendDays) ? (hotel.weekendDays as number[]) : [...DEFAULT_WEEKEND_DAYS]
  return {
    hotelId,
    year,
    month,
    days: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
      dayOfWeek: dow,
      isWeekend: weekendDays.includes(dow),
      ...aggregatePerformance(days.filter((d) => d.date.getUTCDay() === dow), lastYear, totalRooms),
    })),
  }
}

/** 日のタイプ別（平日A型など）。日ごとの型は料金カレンダーと同じ判定（結果の出た日は結果、先の日は今の予約の入り方） */
export async function getDayTypeBreakdownService(hotelId: string, year: number, month: number) {
  const { totalRooms, today, days, lastYear, curves, predictedByDate } = await loadMonthPerformanceDays(hotelId, year, month)
  const model = await loadDayTypeModel(hotelId, today)
  const typed = days.map((d) => {
    const current = buildDayTypeTimeline({
      stayDate: d.date,
      today,
      totalRooms,
      types: model.typesFor(d.date),
      points: curves.get(d.date.getTime()) ?? [],
      actualSoldRooms: d.soldRooms,
      predictedOccupancy: predictedByDate.get(d.date.getTime()) ?? null,
    }).current
    return { day: d, current }
  })
  const groups = new Map<string, { name: string; model: DayModel; id: string; days: PerformanceDay[] }>()
  for (const { day, current } of typed) {
    if (!current) continue
    const group = groups.get(current.id) ?? { name: current.name, model: current.model, id: current.id, days: [] }
    group.days.push(day)
    groups.set(current.id, group)
  }
  const order = ['weekday', 'weekend', 'special']
  return {
    hotelId,
    year,
    month,
    /** 型を作れなかった日（過去の実績が足りない） */
    untypedDays: typed.filter((t) => !t.current).length,
    types: [...groups.values()]
      .sort((a, b) => order.indexOf(a.id.split('-')[0]) - order.indexOf(b.id.split('-')[0]) || a.id.localeCompare(b.id))
      .map((g) => ({ dayType: g.name, model: g.model, ...aggregatePerformance(g.days, lastYear, totalRooms) })),
  }
}
