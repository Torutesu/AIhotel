import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'
import {maxOf, median, minOf} from '../lib/stats.js'
import { DEFAULT_WEEKEND_DAYS, monthRange } from '../lib/date.js'

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

export interface DayOfWeekRow {
  /** 0=日〜6=土 */
  dayOfWeek: number
  isWeekend: boolean
  days: number
  soldRooms: number
  revenue: number
  occupancy: number | null
  adr: number | null
  revPar: number | null
}

/** 曜日別の集計（純関数）。週末は Hotel.weekendDays で判定する（ハードコードしない） */
export function aggregateDayOfWeek(
  rows: Array<{ date: Date; soldRooms: number | null; totalRevenue: number | null }>,
  totalRooms: number,
  weekendDays: number[]
): DayOfWeekRow[] {
  return [0, 1, 2, 3, 4, 5, 6].map((dow) => {
    const mine = rows.filter((r) => r.date.getUTCDay() === dow && r.totalRevenue != null)
    const soldRooms = mine.reduce((a, r) => a + (r.soldRooms ?? 0), 0)
    const revenue = mine.reduce((a, r) => a + (r.totalRevenue ?? 0), 0)
    const roomNights = totalRooms * mine.length
    return {
      dayOfWeek: dow,
      isWeekend: weekendDays.includes(dow),
      days: mine.length,
      soldRooms,
      revenue: Math.round(revenue),
      occupancy: roomNights > 0 ? Math.round((soldRooms / roomNights) * 1000) / 1000 : null,
      adr: soldRooms > 0 ? Math.round(revenue / soldRooms) : null,
      revPar: roomNights > 0 ? Math.round(revenue / roomNights) : null,
    }
  })
}

export async function getDayOfWeekBreakdownService(hotelId: string, year: number, month: number) {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, isActive: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  const { start, end } = monthRange(year, month)
  const rows = await prisma.dailyData.findMany({
    where: { hotelId, date: { gte: start, lt: end } },
    select: { date: true, soldRooms: true, totalRevenue: true },
  })
  const weekendDays = Array.isArray(hotel.weekendDays) ? (hotel.weekendDays as number[]) : [...DEFAULT_WEEKEND_DAYS]
  return { hotelId, year, month, days: aggregateDayOfWeek(rows, hotel.totalRooms, weekendDays) }
}
