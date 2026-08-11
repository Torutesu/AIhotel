import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'
import type { CancellationQueryInput } from '../lib/validators.js'
import { toUtcDate } from './ingestService.js'

// ======================================
// キャンセル分析（Phase 4B — F-CXL-01）
// 機能リスト「⑤キャンセル分析（合計値）」: 日別/月別 × キャンセル室数・件数・室料売上、
// 予約:キャンセル差異（室数・件数・室料）、期間比較(FROM-TO)、前年差異。
//
// 集計元は Reservation の最新断面（capturedDate）。キャンセルはPMSの
// cancelledAt を持つ明細で、日付軸は「予約が入っていた宿泊日(checkIn)」ではなく
// キャンセルが発生した日（cancelledAt）とする — 現場の日次キャンセル管理と揃えるため。
// ======================================

export interface CancellationBucket {
  period: string // 'YYYY-MM-DD' または 'YYYY-MM'
  bookedRooms: number
  bookedCount: number
  bookedRevenue: number
  cancelledRooms: number
  cancelledCount: number
  cancelledRevenue: number
  // 予約:キャンセル差異（機能リスト「予約：キャンセル＜室数/件数/室料差異＞」）
  diffRooms: number
  diffCount: number
  diffRevenue: number
  cancellationRate: number // キャンセル室数 / 予約室数
}

function periodKey(date: Date, granularity: 'daily' | 'monthly'): string {
  const iso = toUtcDate(date).toISOString()
  return granularity === 'monthly' ? iso.slice(0, 7) : iso.slice(0, 10)
}

function emptyBucket(period: string): CancellationBucket {
  return {
    period,
    bookedRooms: 0,
    bookedCount: 0,
    bookedRevenue: 0,
    cancelledRooms: 0,
    cancelledCount: 0,
    cancelledRevenue: 0,
    diffRooms: 0,
    diffCount: 0,
    diffRevenue: 0,
    cancellationRate: 0,
  }
}

interface AggregatableReservation {
  bookedAt: Date | null
  cancelledAt: Date | null
  rooms: number
  roomRevenue: number | null
}

/**
 * 予約日別の予約実績とキャンセル発生日別のキャンセルを同じ期間軸に集計する。
 * 純関数（テスト対象）。
 */
export function aggregateCancellations(
  reservations: AggregatableReservation[],
  granularity: 'daily' | 'monthly',
  start: Date,
  end: Date
): CancellationBucket[] {
  const buckets = new Map<string, CancellationBucket>()
  const startMs = toUtcDate(start).getTime()
  const endMs = toUtcDate(end).getTime()

  const inRange = (d: Date) => {
    const ms = toUtcDate(d).getTime()
    return ms >= startMs && ms <= endMs
  }

  const bucketFor = (date: Date) => {
    const key = periodKey(date, granularity)
    let b = buckets.get(key)
    if (!b) {
      b = emptyBucket(key)
      buckets.set(key, b)
    }
    return b
  }

  for (const r of reservations) {
    if (r.bookedAt && inRange(r.bookedAt)) {
      const b = bucketFor(r.bookedAt)
      b.bookedRooms += r.rooms
      b.bookedCount += 1
      b.bookedRevenue += r.roomRevenue ?? 0
    }
    if (r.cancelledAt && inRange(r.cancelledAt)) {
      const b = bucketFor(r.cancelledAt)
      b.cancelledRooms += r.rooms
      b.cancelledCount += 1
      b.cancelledRevenue += r.roomRevenue ?? 0
    }
  }

  for (const b of buckets.values()) {
    b.diffRooms = b.bookedRooms - b.cancelledRooms
    b.diffCount = b.bookedCount - b.cancelledCount
    b.diffRevenue = Math.round(b.bookedRevenue - b.cancelledRevenue)
    b.bookedRevenue = Math.round(b.bookedRevenue)
    b.cancelledRevenue = Math.round(b.cancelledRevenue)
    b.cancellationRate =
      b.bookedRooms > 0 ? Math.round((b.cancelledRooms / b.bookedRooms) * 1000) / 1000 : 0
  }

  return [...buckets.values()].sort((a, b) => a.period.localeCompare(b.period))
}

function shiftYear(date: Date, years: number): Date {
  const d = toUtcDate(date)
  return new Date(Date.UTC(d.getUTCFullYear() + years, d.getUTCMonth(), d.getUTCDate()))
}

function sumTotals(buckets: CancellationBucket[]) {
  return buckets.reduce(
    (acc, b) => ({
      bookedRooms: acc.bookedRooms + b.bookedRooms,
      bookedCount: acc.bookedCount + b.bookedCount,
      bookedRevenue: acc.bookedRevenue + b.bookedRevenue,
      cancelledRooms: acc.cancelledRooms + b.cancelledRooms,
      cancelledCount: acc.cancelledCount + b.cancelledCount,
      cancelledRevenue: acc.cancelledRevenue + b.cancelledRevenue,
    }),
    {
      bookedRooms: 0,
      bookedCount: 0,
      bookedRevenue: 0,
      cancelledRooms: 0,
      cancelledCount: 0,
      cancelledRevenue: 0,
    }
  )
}

async function loadReservations(hotelId: string, start: Date, end: Date) {
  // 予約日 or キャンセル日が期間に入る明細を拾う
  return prisma.reservation.findMany({
    where: {
      hotelId,
      OR: [
        { bookedAt: { gte: start, lte: end } },
        { cancelledAt: { gte: start, lte: end } },
      ],
    },
    select: { bookedAt: true, cancelledAt: true, rooms: true, roomRevenue: true },
  })
}

/**
 * キャンセル分析（F-CXL-01）
 */
export async function getCancellationAnalysisService(input: CancellationQueryInput) {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const start = toUtcDate(input.startDate)
  const end = toUtcDate(input.endDate)

  const current = await loadReservations(hotel.id, start, end)
  const buckets = aggregateCancellations(current, input.granularity, start, end)
  const totals = sumTotals(buckets)

  let lastYear: { buckets: CancellationBucket[]; totals: ReturnType<typeof sumTotals> } | null = null
  if (input.compareLastYear) {
    const lyStart = shiftYear(start, -1)
    const lyEnd = shiftYear(end, -1)
    const lyRows = await loadReservations(hotel.id, lyStart, lyEnd)
    const lyBuckets = aggregateCancellations(lyRows, input.granularity, lyStart, lyEnd)
    lastYear = { buckets: lyBuckets, totals: sumTotals(lyBuckets) }
  }

  return {
    hotelId: hotel.id,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    granularity: input.granularity,
    buckets,
    totals: {
      ...totals,
      bookedRevenue: Math.round(totals.bookedRevenue),
      cancelledRevenue: Math.round(totals.cancelledRevenue),
      diffRooms: totals.bookedRooms - totals.cancelledRooms,
      diffCount: totals.bookedCount - totals.cancelledCount,
      diffRevenue: Math.round(totals.bookedRevenue - totals.cancelledRevenue),
      cancellationRate:
        totals.bookedRooms > 0
          ? Math.round((totals.cancelledRooms / totals.bookedRooms) * 1000) / 1000
          : 0,
    },
    lastYear,
  }
}
