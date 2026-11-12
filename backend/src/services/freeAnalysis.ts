import { prisma } from '../lib/prisma.js'
import { monthRange } from '../lib/date.js'
import { NotFoundError } from '../middlewares/errorHandler.js'
import type { FreeAnalysisQuery } from '../lib/validators.js'
import { GUEST_SEGMENTS, LEAD_WINDOWS, guestSegment, type ReservationRecord } from './reservationAnalysis.js'

// フリー分析（D-13 — 分析タブ）。予約明細の対象月の泊を、選んだ1〜2つの軸で分けて集計する。
// 軸: チャネル・予約期間（リードタイム）・利用人数・曜日・日付（日付は軸1だけ）。部屋タイプと顧客セグメントは予約明細に無いので出さない。
// 取消の予約は数えない。稼働率と REV-Per の分母は「客室数 × その区分の日数」（曜日・日付ならその日数、ほかは月の日数）。
// 室料のない予約は ADR・REV-Per・室料売上から外す（室料のある予約が1件も無ければ null）。純関数 aggregateFree をテストで固定する

const DAY_MS = 86_400_000
const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'] as const
/** チャネルは上位10社＋その他（需要構成のチャネル別と同じ） */
const TOP_CHANNELS = 10
const OTHER_CHANNEL = 'その他'
const UNKNOWN_CHANNEL = 'チャネル不明'

type Axis = FreeAnalysisQuery['axis1']
type Metric = FreeAnalysisQuery['metric']
export type FreeRecord = Pick<ReservationRecord, 'bookedDate' | 'checkInDate' | 'nights' | 'rooms' | 'guests' | 'revenue' | 'cancelledDate'> & { channel: string | null }

const iso = (d: Date) => d.toISOString().slice(0, 10)
const weekdayOf = (d: Date) => WEEKDAYS[(d.getUTCDay() + 6) % 7]
const leadOf = (r: FreeRecord) => {
  const lead = Math.max(0, Math.round((r.checkInDate.getTime() - r.bookedDate.getTime()) / DAY_MS))
  return LEAD_WINDOWS.find((w) => lead >= w.min && lead <= w.max)!.label
}

interface Cell {
  roomNights: number
  revenue: number
  pricedRoomNights: number
  reservations: Set<FreeRecord>
  days: Set<number>
}

export function aggregateFree(rows: FreeRecord[], q: Pick<FreeAnalysisQuery, 'axis1' | 'axis2' | 'metric'>, start: Date, end: Date, totalRooms: number) {
  const daysInMonth = Math.round((end.getTime() - start.getTime()) / DAY_MS)
  // チャネルの上位（室数の多い順）
  const channelRooms = new Map<string, number>()
  const nights: Array<{ r: FreeRecord; d: Date }> = []
  for (const r of rows) {
    if (r.cancelledDate) continue
    for (let n = 0; n < r.nights; n++) {
      const d = new Date(r.checkInDate.getTime() + n * DAY_MS)
      if (d < start || d >= end) continue
      nights.push({ r, d })
      const ch = r.channel?.trim() || UNKNOWN_CHANNEL
      channelRooms.set(ch, (channelRooms.get(ch) ?? 0) + r.rooms)
    }
  }
  const ranked = [...channelRooms.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)
  const topChannels = new Set(ranked.slice(0, TOP_CHANNELS))
  const keyOf = (axis: Axis, r: FreeRecord, d: Date): string => {
    switch (axis) {
      case 'channel': {
        const ch = r.channel?.trim() || UNKNOWN_CHANNEL
        return topChannels.has(ch) ? ch : OTHER_CHANNEL
      }
      case 'booking':
        return leadOf(r)
      case 'guests':
        return guestSegment(r)
      case 'dayofweek':
        return weekdayOf(d)
      case 'date':
        return iso(d)
    }
  }
  const order = (axis: Axis, present: Set<string>): string[] => {
    const all =
      axis === 'channel'
        ? [...ranked.filter((c) => topChannels.has(c)), OTHER_CHANNEL]
        : axis === 'booking'
          ? LEAD_WINDOWS.map((w) => w.label)
          : axis === 'guests'
            ? [...GUEST_SEGMENTS]
            : axis === 'dayofweek'
              ? [...WEEKDAYS]
              : [...present].sort()
    return all.filter((k) => present.has(k))
  }

  const cells = new Map<string, Cell>()
  const keys1 = new Set<string>()
  const keys2 = new Set<string>()
  for (const { r, d } of nights) {
    const k1 = keyOf(q.axis1, r, d)
    const k2 = q.axis2 ? keyOf(q.axis2, r, d) : ''
    keys1.add(k1)
    if (q.axis2) keys2.add(k2)
    const id = `${k1}\u0000${k2}`
    const cell = cells.get(id) ?? { roomNights: 0, revenue: 0, pricedRoomNights: 0, reservations: new Set(), days: new Set() }
    cell.roomNights += r.rooms
    if (r.revenue != null) {
      cell.revenue += r.revenue / r.nights
      cell.pricedRoomNights += r.rooms
    }
    cell.reservations.add(r)
    cell.days.add(d.getTime())
    cells.set(id, cell)
  }

  // 稼働率・REV-Per の分母の日数: 曜日・日付の軸があればその区分の月内の日数
  const dayAxis = q.axis1 === 'dayofweek' || q.axis1 === 'date' ? 'axis1' : q.axis2 === 'dayofweek' ? 'axis2' : null
  const daysFor = (k1: string, k2: string) => {
    if (!dayAxis) return daysInMonth
    const axis = dayAxis === 'axis1' ? q.axis1 : q.axis2
    const key = dayAxis === 'axis1' ? k1 : k2
    if (axis === 'date') return 1
    let count = 0
    for (let t = start.getTime(); t < end.getTime(); t += DAY_MS) if (weekdayOf(new Date(t)) === key) count++
    return count
  }
  const valueOf = (metric: Metric, cell: Cell | undefined, capacity: number): number | null => {
    if (!cell) return metric === 'adr' ? null : 0
    const priced = cell.pricedRoomNights > 0
    switch (metric) {
      case 'rooms':
        return cell.roomNights
      case 'occupancy':
        return capacity > 0 ? Math.round((cell.roomNights / capacity) * 1000) / 10 : null
      case 'adr':
        return priced ? Math.round(cell.revenue / cell.pricedRoomNights) : null
      case 'revpar':
        return priced && capacity > 0 ? Math.round(cell.revenue / capacity) : null
      case 'revenue':
        return priced ? Math.round(cell.revenue) : null
      case 'bookings':
        return cell.reservations.size
    }
  }

  const axis1Values = order(q.axis1, keys1)
  const axis2Values = q.axis2 ? order(q.axis2, keys2) : []
  const result: Array<{ axis1: string; axis2: string | null; value: number | null }> = []
  for (const k1 of axis1Values) {
    for (const k2 of q.axis2 ? axis2Values : ['']) {
      result.push({ axis1: k1, axis2: q.axis2 ? k2 : null, value: valueOf(q.metric, cells.get(`${k1}\u0000${k2}`), totalRooms * daysFor(k1, k2)) })
    }
  }
  return { axis1Values, axis2Values, rows: result, reservations: new Set(nights.map((n) => n.r)).size }
}

/** GET /analysis/free */
export async function getFreeAnalysisService(q: FreeAnalysisQuery) {
  const hotel = await prisma.hotel.findFirst({ where: { id: q.hotelId, isActive: true }, select: { totalRooms: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  const { start, end } = monthRange(q.year, q.month)
  const rows = await prisma.reservation.findMany({
    where: { hotelId: q.hotelId, checkInDate: { gte: new Date(start.getTime() - 60 * DAY_MS), lt: end } },
    select: { bookedDate: true, checkInDate: true, nights: true, rooms: true, guests: true, revenue: true, cancelledDate: true, channel: true },
  })
  return { year: q.year, month: q.month, axis1: q.axis1, axis2: q.axis2 ?? null, metric: q.metric, ...aggregateFree(rows, q, start, end, hotel.totalRooms) }
}
