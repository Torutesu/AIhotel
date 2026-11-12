import { prisma } from '../lib/prisma.js'
import { monthRange } from '../lib/date.js'
import { NotFoundError } from '../middlewares/errorHandler.js'

// 予約明細の集計（D-13 — 分析タブの「予約動向（リードタイム・キャンセル）」と「利用人数別」を実データにする）。
// 対象月の泊（ルームナイト）を、予約ごとに次の区分で分ける:
//   - リードタイム = チェックイン日 − 予約日（当日〜181日以上前）
//   - 利用人数 = 宿泊人数 ÷ 室数（1名・2名・3名・4名以上。人数の無い予約は「人数不明」）
// 室料は1泊あたり（室料 ÷ 泊数）を対象月の泊に配る。取消日のある予約は取消として別に数える。
// 前年同月比は前年同月の明細があるときだけ（無ければ null）。純関数 aggregate* をテストで固定する。

const DAY_MS = 86_400_000

export const LEAD_WINDOWS: Array<{ label: string; min: number; max: number }> = [
  { label: '当日', min: 0, max: 0 },
  { label: '1-3日前', min: 1, max: 3 },
  { label: '4-7日前', min: 4, max: 7 },
  { label: '8-14日前', min: 8, max: 14 },
  { label: '15-30日前', min: 15, max: 30 },
  { label: '31-60日前', min: 31, max: 60 },
  { label: '61-90日前', min: 61, max: 90 },
  { label: '91-120日前', min: 91, max: 120 },
  { label: '121-180日前', min: 121, max: 180 },
  { label: '181日以上前', min: 181, max: Infinity },
]
export const GUEST_SEGMENTS = ['1名', '2名', '3名', '4名以上', '人数不明'] as const
/** 月の予約の積み上がりの残日数（画面の月のブッキングカーブと同じ） */
export const SEGMENT_CURVE_LEADS = [180, 150, 120, 90, 75, 60, 45, 30, 21, 14, 7, 3, 1, 0]

export interface ReservationRecord {
  bookedDate: Date
  checkInDate: Date
  nights: number
  rooms: number
  guests: number | null
  revenue: number | null
  cancelledDate: Date | null
}

/** 対象月の泊だけを取り出した、予約ごとの数 */
interface MonthPart {
  r: ReservationRecord
  /** 対象月の泊の日付 */
  stayDates: Date[]
  roomNights: number
  revenue: number | null
  guestNights: number | null
  lead: number
  cancelled: boolean
}

function monthParts(rows: ReservationRecord[], start: Date, end: Date): MonthPart[] {
  const parts: MonthPart[] = []
  for (const r of rows) {
    const stayDates: Date[] = []
    for (let n = 0; n < r.nights; n++) {
      const d = new Date(r.checkInDate.getTime() + n * DAY_MS)
      if (d >= start && d < end) stayDates.push(d)
    }
    if (stayDates.length === 0) continue
    parts.push({
      r,
      stayDates,
      roomNights: r.rooms * stayDates.length,
      revenue: r.revenue == null ? null : (r.revenue / r.nights) * stayDates.length,
      guestNights: r.guests == null ? null : r.guests * stayDates.length,
      lead: Math.max(0, Math.round((r.checkInDate.getTime() - r.bookedDate.getTime()) / DAY_MS)),
      cancelled: r.cancelledDate != null,
    })
  }
  return parts
}

const round1 = (v: number) => Math.round(v * 10) / 10
const sum = (v: number[]) => v.reduce((a, b) => a + b, 0)

interface Metrics {
  roomNights: number
  revenue: number | null
  adr: number | null
  guestUnitPrice: number | null
  dor: number | null
  avgNights: number | null
  reservations: number
}

function metrics(parts: MonthPart[]): Metrics {
  const withRevenue = parts.filter((p) => p.revenue != null)
  const withGuests = parts.filter((p) => p.guestNights != null)
  const withBoth = parts.filter((p) => p.revenue != null && p.guestNights != null)
  const revenue = withRevenue.length > 0 ? sum(withRevenue.map((p) => p.revenue as number)) : null
  const revenueRoomNights = sum(withRevenue.map((p) => p.roomNights))
  const guestNights = sum(withBoth.map((p) => p.guestNights as number))
  const guestRoomNights = sum(withGuests.map((p) => p.roomNights))
  return {
    roomNights: sum(parts.map((p) => p.roomNights)),
    revenue: revenue == null ? null : Math.round(revenue),
    adr: revenue != null && revenueRoomNights > 0 ? Math.round(revenue / revenueRoomNights) : null,
    guestUnitPrice: guestNights > 0 ? Math.round(sum(withBoth.map((p) => p.revenue as number)) / guestNights) : null,
    dor: guestRoomNights > 0 ? Math.round((sum(withGuests.map((p) => p.guestNights as number)) / guestRoomNights) * 100) / 100 : null,
    avgNights: parts.length > 0 ? round1(sum(parts.map((p) => p.r.nights)) / parts.length) : null,
    reservations: parts.length,
  }
}

const yoyPct = (current: number | null, lastYear: number | null) =>
  current == null || lastYear == null || lastYear === 0 ? null : round1((current / lastYear - 1) * 100)
const share = (part: number | null, total: number | null) => (part == null || !total ? null : round1((part / total) * 100))

export interface AggregateInput {
  rows: ReservationRecord[]
  lastYearRows: ReservationRecord[]
  start: Date
  end: Date
  totalRooms: number
}

/** 予約動向（リードタイム別の予約とキャンセル） */
export function aggregateBookingWindows({ rows, lastYearRows, start, end, totalRooms }: AggregateInput) {
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS)
  const capacity = totalRooms * days
  const parts = monthParts(rows, start, end)
  const lyStart = new Date(Date.UTC(start.getUTCFullYear() - 1, start.getUTCMonth(), 1))
  const lyEnd = new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth(), 1))
  const lyParts = monthParts(lastYearRows, lyStart, lyEnd)
  const active = parts.filter((p) => !p.cancelled)
  const cancelled = parts.filter((p) => p.cancelled)
  const totalRevenue = metrics(active).revenue
  const totalCancelledRooms = sum(cancelled.map((p) => p.roomNights))
  const inWindow = (list: MonthPart[], w: (typeof LEAD_WINDOWS)[number]) => list.filter((p) => p.lead >= w.min && p.lead <= w.max)

  const bookings = LEAD_WINDOWS.map((w) => {
    const a = metrics(inWindow(active, w))
    const c = metrics(inWindow(cancelled, w))
    const ly = metrics(inWindow(lyParts.filter((p) => !p.cancelled), w))
    return {
      window: w.label,
      soldRooms: a.roomNights,
      occupancy: capacity > 0 ? Math.round((a.roomNights / capacity) * 1000) / 1000 : null,
      adr: a.adr,
      guestUnitPrice: a.guestUnitPrice,
      revenue: a.revenue,
      revenueShare: share(a.revenue, totalRevenue),
      cancelRate: a.roomNights + c.roomNights > 0 ? round1((c.roomNights / (a.roomNights + c.roomNights)) * 100) : null,
      dor: a.dor,
      avgNights: a.avgNights,
      yoy: yoyPct(a.revenue ?? a.roomNights, lyParts.length > 0 ? (ly.revenue ?? ly.roomNights) : null),
    }
  })
  const cancels = LEAD_WINDOWS.map((w) => {
    const a = metrics(inWindow(active, w))
    const c = metrics(inWindow(cancelled, w))
    const ly = metrics(inWindow(lyParts.filter((p) => p.cancelled), w))
    return {
      window: w.label,
      rooms: c.roomNights,
      cancelRate: a.roomNights + c.roomNights > 0 ? round1((c.roomNights / (a.roomNights + c.roomNights)) * 100) : null,
      adr: c.adr,
      guestUnitPrice: c.guestUnitPrice,
      revenue: c.revenue,
      share: share(c.roomNights, totalCancelledRooms),
      dor: c.dor,
      avgNights: c.avgNights,
      yoy: yoyPct(c.roomNights, lyParts.length > 0 ? ly.roomNights : null),
    }
  })
  return { bookings, cancels, reservations: parts.length }
}

export function guestSegment(r: Pick<ReservationRecord, "guests" | "rooms">): (typeof GUEST_SEGMENTS)[number] {
  if (r.guests == null || r.rooms <= 0) return '人数不明'
  const perRoom = Math.round(r.guests / r.rooms)
  if (perRoom <= 1) return '1名'
  if (perRoom === 2) return '2名'
  if (perRoom === 3) return '3名'
  return '4名以上'
}

/** その残日数の時点で予約済み・未取消の、対象月の泊の室数 */
function roomsAsOfLead(parts: MonthPart[], lead: number): number {
  let total = 0
  for (const p of parts) {
    for (const d of p.stayDates) {
      const asOf = d.getTime() - lead * DAY_MS
      if (p.r.bookedDate.getTime() <= asOf && (p.r.cancelledDate == null || p.r.cancelledDate.getTime() > asOf)) total += p.r.rooms
    }
  }
  return total
}

/** 利用人数別（需要構成の表と同じ項目）と、区分ごとの月の予約の積み上がり */
export function aggregateGuestCounts({ rows, lastYearRows, start, end, totalRooms }: AggregateInput) {
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS)
  const capacity = totalRooms * days
  const parts = monthParts(rows, start, end)
  const lyStart = new Date(Date.UTC(start.getUTCFullYear() - 1, start.getUTCMonth(), 1))
  const lyEnd = new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth(), 1))
  const lyParts = monthParts(lastYearRows, lyStart, lyEnd)
  const active = parts.filter((p) => !p.cancelled)
  const all = metrics(active)
  const segments = GUEST_SEGMENTS.map((name) => {
    const segParts = parts.filter((p) => guestSegment(p.r) === name)
    const seg = segParts.filter((p) => !p.cancelled)
    const lySeg = lyParts.filter((p) => guestSegment(p.r) === name)
    const m = metrics(seg)
    const ly = metrics(lySeg.filter((p) => !p.cancelled))
    return {
      key: name,
      name,
      soldRooms: m.roomNights,
      occupancy: capacity > 0 ? Math.round((m.roomNights / capacity) * 1000) / 1000 : null,
      adr: m.adr,
      guestUnitPrice: m.guestUnitPrice,
      revenue: m.revenue,
      revenueShare: share(m.revenue, all.revenue),
      roomsShare: share(m.roomNights, all.roomNights),
      dor: m.dor,
      avgNights: m.avgNights,
      yoy: yoyPct(m.revenue ?? m.roomNights, lyParts.length > 0 ? (ly.revenue ?? ly.roomNights) : null),
      curve: SEGMENT_CURVE_LEADS.map((lead) => ({
        lead,
        rooms: roomsAsOfLead(segParts, lead),
        lastYear: lyParts.length > 0 ? roomsAsOfLead(lySeg, lead) : null,
      })),
    }
  }).filter((s) => s.soldRooms > 0 || s.key !== '人数不明')
  return { segments, reservations: parts.length }
}

async function loadMonth(hotelId: string, year: number, month: number) {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, isActive: true }, select: { totalRooms: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  const { start, end } = monthRange(year, month)
  const ly = monthRange(year - 1, month)
  // 泊数は最大60泊なので、60日前のチェックインまで見れば対象月にかかる予約はすべて入る
  const select = { bookedDate: true, checkInDate: true, nights: true, rooms: true, guests: true, revenue: true, cancelledDate: true } as const
  const [rows, lastYearRows] = await Promise.all([
    prisma.reservation.findMany({ where: { hotelId, checkInDate: { gte: new Date(start.getTime() - 60 * DAY_MS), lt: end } }, select }),
    prisma.reservation.findMany({ where: { hotelId, checkInDate: { gte: new Date(ly.start.getTime() - 60 * DAY_MS), lt: ly.end } }, select }),
  ])
  return { rows, lastYearRows, start, end, totalRooms: hotel.totalRooms }
}

/** GET /analysis/booking-windows */
export async function getBookingWindowsService(hotelId: string, year: number, month: number) {
  return aggregateBookingWindows(await loadMonth(hotelId, year, month))
}

/** GET /analysis/guest-counts */
export async function getGuestCountsService(hotelId: string, year: number, month: number) {
  return aggregateGuestCounts(await loadMonth(hotelId, year, month))
}

// ======================================
// 宿泊日・宿泊月のブッキングカーブの系列（分析タブのブッキングカーブグラフ — D-13）
// 稼働室数の実測（全体）は GET /daily/booking-curve（予約の推移）が出す。ここは予約明細から
// ADR・前年（364日前 = 同じ曜日）・利用人数別の内訳と、月単位の積み上がりを作る。予算は日別予算・月の予算の室数（最終の目標）
// ======================================

/** 宿泊日のカーブの残日数の範囲（0〜180日前） */
export const STAY_CURVE_MAX_DAYS = 180

type CurveRecord = Pick<ReservationRecord, 'bookedDate' | 'checkInDate' | 'nights' | 'rooms' | 'guests' | 'revenue' | 'cancelledDate'>

const covers = (r: CurveRecord, d: Date) => r.checkInDate.getTime() <= d.getTime() && d.getTime() < r.checkInDate.getTime() + r.nights * DAY_MS
/** 時点 asOf で予約済み・未取消か（取消日の前日までの時点だけに数える） */
const onBooks = (r: CurveRecord, asOf: number) => r.bookedDate.getTime() <= asOf && (r.cancelledDate == null || r.cancelledDate.getTime() > asOf)

/** 予約の ADR（1泊あたりの室料 ÷ 室数。室料のある予約だけ） */
function adrOf(list: CurveRecord[]): number | null {
  const priced = list.filter((r) => r.revenue != null)
  const rooms = sum(priced.map((r) => r.rooms))
  return rooms > 0 ? Math.round(sum(priced.map((r) => (r.revenue as number) / r.nights)) / rooms) : null
}

/** 1つの宿泊日の、残日数ごとの室数・ADR・前年の室数・利用人数別の室数と ADR（純関数）。fromDaysBefore より前（未来の時点）は作らない */
export function aggregateStayDateCurve(rows: CurveRecord[], lastYearRows: CurveRecord[], date: Date, fromDaysBefore = 0) {
  const lyDate = new Date(date.getTime() - 364 * DAY_MS)
  const stay = rows.filter((r) => covers(r, date))
  const lyStay = lastYearRows.filter((r) => covers(r, lyDate))
  const points = []
  for (let daysBefore = STAY_CURVE_MAX_DAYS; daysBefore >= Math.max(0, fromDaysBefore); daysBefore--) {
    const asOf = date.getTime() - daysBefore * DAY_MS
    const live = stay.filter((r) => onBooks(r, asOf))
    points.push({
      daysBefore,
      rooms: sum(live.map((r) => r.rooms)),
      adr: adrOf(live),
      lastYearRooms: lyStay.length > 0 ? sum(lyStay.filter((r) => onBooks(r, asOf - 364 * DAY_MS)).map((r) => r.rooms)) : null,
      segments: Object.fromEntries(
        GUEST_SEGMENTS.map((seg) => {
          const list = live.filter((r) => guestSegment(r) === seg)
          return [seg, { rooms: sum(list.map((r) => r.rooms)), adr: adrOf(list) }]
        }),
      ) as Record<(typeof GUEST_SEGMENTS)[number], { rooms: number; adr: number | null }>,
    })
  }
  return { reservations: stay.length, lastYearReservations: lyStay.length, points }
}

/** 宿泊月の積み上がり（残月数 6〜0。0 は月末時点＝最終）。月単位のブッキングカーブ（純関数） */
export function aggregateStayMonthCurve(rows: CurveRecord[], lastYearRows: CurveRecord[], start: Date, end: Date) {
  const lyStart = new Date(Date.UTC(start.getUTCFullYear() - 1, start.getUTCMonth(), 1))
  const lyEnd = new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth(), 1))
  // 残月数 k の時点 = 宿泊月の1日の (k-1) か月前の1日。k=0 は月末（翌月1日）
  const snapshot = (monthStart: Date, k: number) => (k === 0 ? new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1)) : new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - (k - 1), 1)))
  const nightsIn = (list: CurveRecord[], s: Date, e: Date) => {
    const out: Array<{ r: CurveRecord; d: number }> = []
    for (const r of list) for (let n = 0; n < r.nights; n++) {
      const d = r.checkInDate.getTime() + n * DAY_MS
      if (d >= s.getTime() && d < e.getTime()) out.push({ r, d })
    }
    return out
  }
  const nights = nightsIn(rows, start, end)
  const lyNights = nightsIn(lastYearRows, lyStart, lyEnd)
  // 泊の日より後の時点では、その泊の日の時点で数える（泊のあとの予約・取消は関係ない）
  const asOf = (list: typeof nights, t: Date, filter?: (r: CurveRecord) => boolean) =>
    sum(list.filter(({ r, d }) => (!filter || filter(r)) && onBooks(r, Math.min(t.getTime(), d))).map(({ r }) => r.rooms))
  const ks = [7, 6, 5, 4, 3, 2, 1, 0]
  const cumulative = ks.map((k) => asOf(nights, snapshot(start, k)))
  const lyCumulative = ks.map((k) => asOf(lyNights, snapshot(lyStart, k)))
  const segCumulative = Object.fromEntries(
    GUEST_SEGMENTS.map((s) => [s, ks.map((k) => asOf(nights, snapshot(start, k), (r) => guestSegment(r) === s))]),
  ) as Record<(typeof GUEST_SEGMENTS)[number], number[]>
  const points = ks.slice(1).map((k, i) => ({
    monthsBefore: k,
    cumulative: cumulative[i + 1],
    monthly: cumulative[i + 1] - cumulative[i],
    lastYearCumulative: lyNights.length > 0 ? lyCumulative[i + 1] : null,
    segments: Object.fromEntries(GUEST_SEGMENTS.map((s) => [s, segCumulative[s][i + 1]])) as Record<(typeof GUEST_SEGMENTS)[number], number>,
  }))
  return { reservations: new Set(nights.map(({ r }) => r)).size, points }
}

const CURVE_SELECT = { bookedDate: true, checkInDate: true, nights: true, rooms: true, guests: true, revenue: true, cancelledDate: true } as const

/** 宿泊日の予約明細から、ブッキングカーブの ADR の推移と利用人数別の内訳を作る（GET /daily/booking-curve が使う）。明細が無ければ null */
export async function loadStayDateSeries(hotelId: string, date: Date, today: Date) {
  const around = { gte: new Date(date.getTime() - 60 * DAY_MS), lte: date }
  const rows = await prisma.reservation.findMany({ where: { hotelId, checkInDate: around }, select: CURVE_SELECT })
  const fromDaysBefore = Math.max(0, Math.round((date.getTime() - today.getTime()) / DAY_MS))
  const curve = aggregateStayDateCurve(rows, [], date, fromDaysBefore)
  if (curve.reservations === 0) return null
  return {
    adrHistory: curve.points.map((p) => ({ daysBefore: p.daysBefore, adr: p.adr })),
    guests: GUEST_SEGMENTS.filter((seg) => curve.points.some((p) => p.segments[seg].rooms > 0)).map((seg) => ({
      label: seg === '人数不明' ? seg : `${seg}利用`,
      points: curve.points.map((p) => ({ daysBefore: p.daysBefore, roomsBooked: p.segments[seg].rooms, adr: p.segments[seg].adr })),
    })),
  }
}

/** GET /analysis/month-curve?year=&month= — 月単位のブッキングカーブ */
export async function getStayMonthCurveService(hotelId: string, year: number, month: number) {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, isActive: true }, select: { totalRooms: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  const { start, end } = monthRange(year, month)
  const ly = monthRange(year - 1, month)
  const [rows, lastYearRows, budget] = await Promise.all([
    prisma.reservation.findMany({ where: { hotelId, checkInDate: { gte: new Date(start.getTime() - 60 * DAY_MS), lt: end } }, select: CURVE_SELECT }),
    prisma.reservation.findMany({ where: { hotelId, checkInDate: { gte: new Date(ly.start.getTime() - 60 * DAY_MS), lt: ly.end } }, select: CURVE_SELECT }),
    prisma.monthlyBudget.findFirst({ where: { hotelId, year, month }, select: { budgetRooms: true } }),
  ])
  return { year, month, totalRooms: hotel.totalRooms, budgetRooms: budget?.budgetRooms ?? null, segmentNames: [...GUEST_SEGMENTS], ...aggregateStayMonthCurve(rows, lastYearRows, start, end) }
}
