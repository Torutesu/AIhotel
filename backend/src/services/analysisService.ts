import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'
import {maxOf, median, minOf} from '../lib/stats.js'
import { eachUtcDay, monthRange, todayJst } from '../lib/date.js'
import { loadMonthContext } from './dayContextService.js'
import { lastYearSameWeekday, leadDaysBetween, otbAtLead, type BookingCurvePoint } from './forecast/pace.js'
import { buildMonthPace } from './monthPace.js'
import { monthBudgetRooms } from './budgetAllocation.js'

/**
 * 年間推移 — 月単位（F-ANA-03: クォーターではなく月単位）
 */
export async function getMonthlyTrendService(hotelId: string, year: number) {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, isActive: true } })
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
        minPrice: minOf(prices),
        maxPrice: maxOf(prices),
        // 競合料金の代表値。1社の極端な価格に引きずられない中央値を使う（C-9）
        medianPrice: median(prices),
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

// ======================================
// 内訳の集計（#88）: チャネル別・部屋タイプ別・曜日別
// ======================================
// いずれも対象月の実績だけを集計する（予測は含めない）。
// 集計は DB から行を取ってから純関数で行い、単体テストで固定する。

const round1 = (v: number) => Math.round(v * 10) / 10

/** 前月（1月なら前年12月） */
function previousMonth(year: number, month: number) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
}

export interface ChannelRow {
  channel: string
  roomsSold: number
  revenue: number
  adr: number | null
  /** 室料売上に占める割合（%） */
  revenueShare: number
  /** 前月比（%）。前月の実績が無ければ null */
  revenueGrowth: number | null
}

/** チャネル別の集計（純関数） */
export function aggregateChannels(
  current: Array<{ channel: string; roomsSold: number | null; revenue: number | null }>,
  previous: Array<{ channel: string; revenue: number | null }>
): ChannelRow[] {
  const sum = new Map<string, { roomsSold: number; revenue: number }>()
  for (const row of current) {
    const acc = sum.get(row.channel) ?? { roomsSold: 0, revenue: 0 }
    acc.roomsSold += row.roomsSold ?? 0
    acc.revenue += row.revenue ?? 0
    sum.set(row.channel, acc)
  }
  const prev = new Map<string, number>()
  for (const row of previous) prev.set(row.channel, (prev.get(row.channel) ?? 0) + (row.revenue ?? 0))

  const total = [...sum.values()].reduce((a, b) => a + b.revenue, 0)
  return [...sum.entries()]
    .map(([channel, v]) => {
      const before = prev.get(channel)
      return {
        channel,
        roomsSold: v.roomsSold,
        revenue: Math.round(v.revenue),
        adr: v.roomsSold > 0 ? Math.round(v.revenue / v.roomsSold) : null,
        revenueShare: total > 0 ? round1((v.revenue / total) * 100) : 0,
        revenueGrowth: before && before > 0 ? round1(((v.revenue - before) / before) * 100) : null,
      }
    })
    .sort((a, b) => b.revenue - a.revenue)
}

export async function getChannelBreakdownService(hotelId: string, year: number, month: number) {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, isActive: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  const { start, end } = monthRange(year, month)
  const before = previousMonth(year, month)
  const prevRange = monthRange(before.year, before.month)

  const [current, previous] = await Promise.all([
    prisma.otaChannelData.findMany({
      where: { hotelId, date: { gte: start, lt: end } },
      select: { channel: true, roomsSold: true, revenue: true },
    }),
    prisma.otaChannelData.findMany({
      where: { hotelId, date: { gte: prevRange.start, lt: prevRange.end } },
      select: { channel: true, revenue: true },
    }),
  ])
  return { hotelId, year, month, channels: aggregateChannels(current, previous) }
}

export interface RoomTypeRow {
  roomTypeId: string
  name: string
  code: string
  count: number
  soldRooms: number
  revenue: number
  adr: number | null
  /** その部屋タイプの室数に対する稼働率（実績日数ぶん） */
  occupancy: number | null
}

/** 部屋タイプ別の集計（純関数） */
export function aggregateRoomTypes(
  roomTypes: Array<{ id: string; name: string; code: string; count: number }>,
  rows: Array<{ roomTypeId: string; soldRooms: number | null; revenue: number | null }>,
  actualDays: number
): RoomTypeRow[] {
  return roomTypes.map((t) => {
    const mine = rows.filter((r) => r.roomTypeId === t.id)
    const soldRooms = mine.reduce((a, r) => a + (r.soldRooms ?? 0), 0)
    const revenue = mine.reduce((a, r) => a + (r.revenue ?? 0), 0)
    const capacity = t.count * actualDays
    return {
      roomTypeId: t.id,
      name: t.name,
      code: t.code,
      count: t.count,
      soldRooms,
      revenue: Math.round(revenue),
      adr: soldRooms > 0 ? Math.round(revenue / soldRooms) : null,
      occupancy: capacity > 0 ? Math.round((soldRooms / capacity) * 1000) / 1000 : null,
    }
  })
}

export async function getRoomTypeBreakdownService(hotelId: string, year: number, month: number) {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, isActive: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  const { start, end } = monthRange(year, month)

  const [roomTypes, rows, actualDays] = await Promise.all([
    prisma.roomType.findMany({
      where: { hotelId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, code: true, count: true },
    }),
    prisma.dailyRoomData.findMany({
      where: { dailyData: { hotelId, date: { gte: start, lt: end } } },
      select: { roomTypeId: true, soldRooms: true, revenue: true },
    }),
    prisma.dailyRoomData
      .findMany({
        where: { dailyData: { hotelId, date: { gte: start, lt: end } } },
        distinct: ['dailyDataId'],
        select: { dailyDataId: true },
      })
      .then((d) => d.length),
  ])
  return { hotelId, year, month, actualDays, roomTypes: aggregateRoomTypes(roomTypes, rows, actualDays) }
}

// ======================================
// 日別パフォーマンス（2026-10 の画面修正: 実績・予算差異・AI想定差異・前年比）
// ======================================

/** 1日ぶんの指標。比べる相手（予算・AI・前年）も同じ形で返し、差は画面で出す */
export interface DayMetrics {
  soldRooms: number | null
  occupancy: number | null
  adr: number | null
  revPar: number | null
  revenue: number | null
}

/** AI の予測を指標にする（予測稼働率 × 客室数 × 予測ADR。予測ADR が無ければ推奨価格）。純関数 */
export function aiDayMetrics(
  rec: { predictedOccupancy: number | null; predictedAdr: number | null; recommendedPrice: number | null } | undefined,
  totalRooms: number
): DayMetrics | null {
  if (!rec || rec.predictedOccupancy == null || totalRooms <= 0) return null
  const soldRooms = Math.round(totalRooms * rec.predictedOccupancy)
  const adr = rec.predictedAdr ?? rec.recommendedPrice
  const revenue = adr == null ? null : soldRooms * adr
  return {
    soldRooms,
    occupancy: rec.predictedOccupancy,
    adr: adr == null ? null : Math.round(adr),
    revPar: revenue == null ? null : Math.round(revenue / totalRooms),
    revenue: revenue == null ? null : Math.round(revenue),
  }
}

/** 結果の出ていない日の予約実数（今の予約室数。今日より前の日・記録の無い日は null）。純関数 */
export function onHandMetrics(day: Date, today: Date, points: BookingCurvePoint[], totalRooms: number): DayMetrics | null {
  const lead = leadDaysBetween(today, day)
  if (lead < 0) return null
  const rooms = otbAtLead(points, lead)
  if (rooms == null) return null
  return { soldRooms: rooms, occupancy: totalRooms > 0 ? Math.round((rooms / totalRooms) * 1000) / 1000 : null, adr: null, revPar: null, revenue: null }
}

/**
 * 対象月の日ごとの実績と、比べる相手（日割り予算・AI の予測・前年同曜日の実績）。
 * 実績はまだ結果の出ていない日は null。AI の予測は推奨を作った日だけ（過去の日の推奨は再計算しても残る）
 */
export async function getDailyPerformanceService(hotelId: string, year: number, month: number) {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, isActive: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  const totalRooms = hotel.totalRooms
  const { start, end } = monthRange(year, month)

  const today = todayJst()
  // 先の日の今の予約室数（予約実数）を出すため、今日以降の宿泊日の予約積上だけ読む
  const future = eachUtcDay(start, end).filter((d) => d >= today)
  const [context, actuals, recommendations] = await Promise.all([
    loadMonthContext(hotelId, totalRooms, year, month, { curves: future }),
    prisma.dailyData.findMany({
      where: { hotelId, date: { gte: start, lt: end } },
      select: { date: true, soldRooms: true, occupancy: true, adr: true, revPar: true, totalRevenue: true },
    }),
    prisma.aiPriceRecommendation.findMany({
      where: { hotelId, date: { gte: start, lt: end }, roomTypeId: null },
      select: { date: true, predictedOccupancy: true, predictedAdr: true, recommendedPrice: true },
    }),
  ])

  const actualByDate = new Map(actuals.map((a) => [a.date.getTime(), a]))
  const recByDate = new Map(recommendations.map((r) => [r.date.getTime(), r]))

  const days = context.days.map((day, index) => {
    const actual = actualByDate.get(day.getTime())
    const lastYearDate = lastYearSameWeekday(day)
    const lastYear = context.lastYearDaily.get(lastYearDate.getTime())
    const budget = context.budgets[index]
    return {
      date: day.toISOString().slice(0, 10),
      actual: actual
        ? {
            soldRooms: actual.soldRooms,
            occupancy: actual.occupancy,
            adr: actual.adr == null ? null : Math.round(actual.adr),
            revPar: actual.revPar == null ? null : Math.round(actual.revPar),
            revenue: actual.totalRevenue == null ? null : Math.round(actual.totalRevenue),
          }
        : null,
      // 予約実数（結果の出ていない日の今の予約室数）。予約の単価・売上は PMS 連携後
      onHand: actual ? null : onHandMetrics(day, today, context.curves.get(day.getTime()) ?? [], totalRooms),
      budget: { soldRooms: budget.rooms, occupancy: budget.occupancy, adr: budget.adr, revPar: budget.revPar, revenue: budget.revenue },
      ai: aiDayMetrics(recByDate.get(day.getTime()), totalRooms),
      lastYearDate: lastYearDate.toISOString().slice(0, 10),
      lastYear: lastYear
        ? {
            soldRooms: lastYear.soldRooms,
            occupancy: lastYear.occupancy,
            adr: lastYear.adr == null ? null : Math.round(lastYear.adr),
            revPar: lastYear.revPar == null ? null : Math.round(lastYear.revPar),
            revenue: lastYear.totalRevenue == null ? null : Math.round(lastYear.totalRevenue),
          }
        : null,
    }
  })

  return { hotelId, year, month, totalRooms, days }
}

/**
 * 月の予約の積み上がり（日別パフォーマンスの「月のグラフ」— 180日前 → 結果）。
 * 月の各宿泊日の「N 日前の予約室数」を足し上げ、日割り予算の合計・AI の予測の合計・前年同曜日の同じ時点と比べる
 */
export async function getMonthPaceService(hotelId: string, year: number, month: number) {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, isActive: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  const totalRooms = hotel.totalRooms
  const { start, end } = monthRange(year, month)

  const [context, actuals, recommendations] = await Promise.all([
    loadMonthContext(hotelId, totalRooms, year, month),
    prisma.dailyData.findMany({ where: { hotelId, date: { gte: start, lt: end } }, select: { date: true, soldRooms: true } }),
    prisma.aiPriceRecommendation.findMany({
      where: { hotelId, date: { gte: start, lt: end }, roomTypeId: null },
      select: { date: true, predictedOccupancy: true },
    }),
  ])
  const actualByDate = new Map(actuals.map((a) => [a.date.getTime(), a.soldRooms]))

  const capacity = totalRooms * context.days.length
  const points = buildMonthPace({
    totalRooms,
    today: todayJst(),
    days: context.days.map((day) => {
      const lastYearKey = lastYearSameWeekday(day).getTime()
      const lastYearPoints = context.lastYearCurves.get(lastYearKey)
      const lastYearDaily = context.lastYearDaily.get(lastYearKey)
      return {
        stayDate: day,
        points: context.curves.get(day.getTime()) ?? [],
        actualSoldRooms: actualByDate.get(day.getTime()) ?? null,
        lastYear:
          lastYearPoints || lastYearDaily
            ? { points: lastYearPoints ?? [], finalRooms: lastYearDaily?.soldRooms ?? null }
            : null,
      }
    }),
  })

  // 予算は日割りの丸めを足し上げず、月の値をそのまま使う
  const monthRooms = context.monthBudget ? monthBudgetRooms(context.monthBudget, totalRooms, context.days.length) : null
  const budgetRooms = monthRooms == null ? null : Math.round(Math.min(monthRooms, capacity))
  // AI の予測は推奨のある日だけ。月の全日にそろっていなければ比べない
  const aiRooms =
    recommendations.length === context.days.length && recommendations.every((r) => r.predictedOccupancy != null)
      ? recommendations.reduce((sum, r) => sum + Math.round(totalRooms * (r.predictedOccupancy as number)), 0)
      : null
  const occupancyOf = (rooms: number | null) => (rooms == null || capacity <= 0 ? null : Math.round((rooms / capacity) * 1000) / 1000)

  return {
    hotelId,
    year,
    month,
    totalRooms,
    days: context.days.length,
    budgetRooms,
    budgetOccupancy: occupancyOf(budgetRooms),
    aiRooms,
    aiOccupancy: occupancyOf(aiRooms),
    points,
  }
}
