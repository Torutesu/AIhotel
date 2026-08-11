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
 * リードタイムは **基準日（referenceDate）からの日数** で測る。
 * - 単日カーブ: 基準日 = その宿泊日
 * - 月間カーブ: 基準日 = 月初（進捗管理表【5日間・10日間】と同じ考え方。
 *   「N日前時点で、その月ぜんぶの予約が何室積み上がっていたか」を見る）
 *
 * 取得日（capturedDate）が同じスナップショットは同一断面なので合算する。
 * 宿泊日ごとにリードタイムを測って合算すると、月の途中では宿泊日ごとに
 * 保有する断面数が変わり、0日前付近が実際より小さく出てしまうため採用しない。
 *
 * 同一バケットに複数の断面が入る場合は、基準日に最も近い断面を採用する。
 */
export function buildCurve(
  snapshots: SnapshotRow[],
  step: number,
  maxDaysBefore: number,
  capacityRoomNights: number | null,
  referenceDate: Date
): CurvePoint[] {
  // 取得日単位に合算（= その日の断面での対象期間トータル）
  const byCaptured = new Map<string, { capturedDate: Date; rooms: number; revenue: number }>()
  for (const s of snapshots) {
    const key = s.capturedDate.toISOString().slice(0, 10)
    const agg = byCaptured.get(key) ?? { capturedDate: s.capturedDate, rooms: 0, revenue: 0 }
    agg.rooms += s.rooms
    agg.revenue += s.revenue ?? 0
    byCaptured.set(key, agg)
  }

  // 基準日からのリードタイムで step 刻みのバケットへ寄せる
  const byBucket = new Map<number, { lead: number; rooms: number; revenue: number }>()
  for (const snap of byCaptured.values()) {
    const lead = daysBetween(snap.capturedDate, referenceDate)
    if (lead < 0 || lead > maxDaysBefore) continue
    const bucket = Math.ceil(lead / step) * step
    const existing = byBucket.get(bucket)
    // 同一バケットには基準日に最も近い断面を残す
    if (!existing || lead < existing.lead) {
      byBucket.set(bucket, { lead, rooms: snap.rooms, revenue: snap.revenue })
    }
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
  // 基準日: 単日は宿泊日、月間は月初（進捗管理表と同じ）
  const points = buildCurve(snapshots, input.step, input.maxDaysBefore, capacityRoomNights, start)

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
        hotel.totalRooms * (daysBetween(lyStart, lyEnd) + 1),
        lyStart
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
