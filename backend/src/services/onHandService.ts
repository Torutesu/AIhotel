import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'
import type { OnHandCurveQueryInput, InventoryQueryInput } from '../lib/validators.js'
import { toUtcDate } from './ingestService.js'

// ======================================
// オンハンド ブッキングカーブ・残室ビュー（Phase 4B — F-OH-03, F-INV-01）
//
// カーブは OnHandSnapshot（宿泊日×取得日の積上）から「リードタイム別」に組み直す。
// 現場の進捗管理表（【進捗管理】5日間・10日間.xlsx）が 360日前〜0日前を10日刻みで
// 前年対比する形式なので、step / maxDaysBefore をパラメータで揃えられるようにする。
// ======================================

const DAY_MS = 24 * 60 * 60 * 1000

export interface CurvePoint {
  daysBefore: number
  rooms: number
  revenue: number
  adr: number
  occupancy: number | null
}

interface SnapshotRow {
  stayDate: Date
  capturedDate: Date
  rooms: number
  revenue: number | null
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((toUtcDate(to).getTime() - toUtcDate(from).getTime()) / DAY_MS)
}

/**
 * スナップショット群をリードタイム別カーブに畳み込む。純関数（テスト対象）。
 *
 * - 各スナップショットのリードタイム = stayDate - capturedDate
 * - step 刻みのバケットへ切り上げ（例 step=10 なら 0,10,20…）
 * - 同一バケットに複数宿泊日が入る場合は合計（月間カーブ）
 * - 同一宿泊日で同一バケットに複数断面がある場合は「宿泊日に最も近い断面」を採用する
 */
export function buildCurve(
  snapshots: SnapshotRow[],
  step: number,
  maxDaysBefore: number,
  capacityRoomNights: number | null
): CurvePoint[] {
  // stayDate+bucket 単位で最も宿泊日に近い断面を選ぶ
  const picked = new Map<string, { daysBefore: number; rooms: number; revenue: number }>()

  for (const s of snapshots) {
    const lead = daysBetween(s.capturedDate, s.stayDate)
    if (lead < 0 || lead > maxDaysBefore) continue
    const bucket = Math.ceil(lead / step) * step
    const key = `${s.stayDate.toISOString().slice(0, 10)}#${bucket}`
    const existing = picked.get(key)
    if (!existing || lead < existing.daysBefore) {
      picked.set(key, { daysBefore: bucket, rooms: s.rooms, revenue: s.revenue ?? 0 })
    }
  }

  const byBucket = new Map<number, { rooms: number; revenue: number }>()
  for (const p of picked.values()) {
    const agg = byBucket.get(p.daysBefore) ?? { rooms: 0, revenue: 0 }
    agg.rooms += p.rooms
    agg.revenue += p.revenue
    byBucket.set(p.daysBefore, agg)
  }

  return [...byBucket.entries()]
    .map(([daysBefore, agg]) => ({
      daysBefore,
      rooms: agg.rooms,
      revenue: Math.round(agg.revenue),
      adr: agg.rooms > 0 ? Math.round(agg.revenue / agg.rooms) : 0,
      occupancy:
        capacityRoomNights && capacityRoomNights > 0
          ? Math.round((agg.rooms / capacityRoomNights) * 1000) / 1000
          : null,
    }))
    .sort((a, b) => b.daysBefore - a.daysBefore) // 360日前 → 0日前（右肩上がり）
}

function shiftYear(date: Date, years: number): Date {
  const d = toUtcDate(date)
  return new Date(Date.UTC(d.getUTCFullYear() + years, d.getUTCMonth(), d.getUTCDate()))
}

async function loadSnapshots(hotelId: string, start: Date, end: Date): Promise<SnapshotRow[]> {
  return prisma.onHandSnapshot.findMany({
    where: { hotelId, stayDate: { gte: start, lte: end } },
    select: { stayDate: true, capturedDate: true, rooms: true, revenue: true },
  })
}

/**
 * オンハンド ブッキングカーブ（F-OH-03）
 * stayDate 指定で単日、year+month 指定で月合計値のカーブを返す。
 */
export async function getOnHandCurveService(input: OnHandCurveQueryInput) {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  let start: Date
  let end: Date
  let scope: 'daily' | 'monthly'

  if (input.stayDate) {
    start = toUtcDate(input.stayDate)
    end = start
    scope = 'daily'
  } else {
    const year = input.year!
    const month = input.month!
    start = new Date(Date.UTC(year, month - 1, 1))
    end = new Date(Date.UTC(year, month, 0)) // 月末日
    scope = 'monthly'
  }

  const dayCount = daysBetween(start, end) + 1
  const capacityRoomNights = hotel.totalRooms * dayCount

  const snapshots = await loadSnapshots(hotel.id, start, end)
  const points = buildCurve(snapshots, input.step, input.maxDaysBefore, capacityRoomNights)

  let lastYear: { points: CurvePoint[]; startDate: string; endDate: string } | null = null
  if (input.compareLastYear) {
    const lyStart = shiftYear(start, -1)
    const lyEnd = shiftYear(end, -1)
    const lySnapshots = await loadSnapshots(hotel.id, lyStart, lyEnd)
    lastYear = {
      points: buildCurve(
        lySnapshots,
        input.step,
        input.maxDaysBefore,
        hotel.totalRooms * (daysBetween(lyStart, lyEnd) + 1)
      ),
      startDate: lyStart.toISOString().slice(0, 10),
      endDate: lyEnd.toISOString().slice(0, 10),
    }
  }

  return {
    hotelId: hotel.id,
    scope,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    step: input.step,
    maxDaysBefore: input.maxDaysBefore,
    totalRooms: hotel.totalRooms,
    capacityRoomNights,
    points,
    lastYear,
  }
}

/**
 * 残室ビュー（F-INV-01 — ◆HG2608残室.xlsx 相当）
 * 日別×タイプ別の残室と、前回断面との差異を返す。
 */
export async function getInventoryViewService(input: InventoryQueryInput) {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const start = toUtcDate(input.startDate)
  const end = toUtcDate(input.endDate)

  // 対象断面: 指定が無ければ最新
  const latest = await prisma.roomInventorySnapshot.findFirst({
    where: {
      hotelId: hotel.id,
      ...(input.capturedDate && { capturedDate: toUtcDate(input.capturedDate) }),
    },
    orderBy: { capturedDate: 'desc' },
    select: { capturedDate: true },
  })
  if (!latest) {
    return {
      hotelId: hotel.id,
      capturedDate: null,
      previousCapturedDate: null,
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      roomTypes: [],
      rows: [],
    }
  }

  const capturedDate = latest.capturedDate

  const previous = input.comparePrevious
    ? await prisma.roomInventorySnapshot.findFirst({
        where: { hotelId: hotel.id, capturedDate: { lt: capturedDate } },
        orderBy: { capturedDate: 'desc' },
        select: { capturedDate: true },
      })
    : null

  const [currentRows, previousRows] = await Promise.all([
    prisma.roomInventorySnapshot.findMany({
      where: { hotelId: hotel.id, capturedDate, stayDate: { gte: start, lte: end } },
      orderBy: [{ stayDate: 'asc' }, { roomTypeCode: 'asc' }],
    }),
    previous
      ? prisma.roomInventorySnapshot.findMany({
          where: {
            hotelId: hotel.id,
            capturedDate: previous.capturedDate,
            stayDate: { gte: start, lte: end },
          },
          select: { stayDate: true, roomTypeCode: true, remainingRooms: true },
        })
      : Promise.resolve([]),
  ])

  const prevByKey = new Map(
    previousRows.map((r) => [`${r.stayDate.toISOString().slice(0, 10)}#${r.roomTypeCode}`, r])
  )

  // 日付 → タイプ別残室 の行列に組み直す（在庫表と同じ見た目にする）
  const byDate = new Map<
    string,
    { stayDate: string; totalRemaining: number; byRoomType: Record<string, { remaining: number; total: number | null; diff: number | null }> }
  >()
  const roomTypes = new Set<string>()

  for (const row of currentRows) {
    const key = row.stayDate.toISOString().slice(0, 10)
    roomTypes.add(row.roomTypeCode)
    let entry = byDate.get(key)
    if (!entry) {
      entry = { stayDate: key, totalRemaining: 0, byRoomType: {} }
      byDate.set(key, entry)
    }
    const prev = prevByKey.get(`${key}#${row.roomTypeCode}`)
    entry.byRoomType[row.roomTypeCode] = {
      remaining: row.remainingRooms,
      total: row.totalRooms,
      diff: prev ? row.remainingRooms - prev.remainingRooms : null,
    }
    entry.totalRemaining += row.remainingRooms
  }

  return {
    hotelId: hotel.id,
    capturedDate: capturedDate.toISOString().slice(0, 10),
    previousCapturedDate: previous ? previous.capturedDate.toISOString().slice(0, 10) : null,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    totalRooms: hotel.totalRooms,
    roomTypes: [...roomTypes].sort(),
    rows: [...byDate.values()].sort((a, b) => a.stayDate.localeCompare(b.stayDate)),
  }
}
