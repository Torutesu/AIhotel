import { SegmentKind } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'
import type {
  SegmentAnalysisQueryInput,
  SegmentAxis,
  RankingQueryInput,
} from '../lib/validators.js'
import { toUtcDate } from './ingestService.js'

// ======================================
// セグメント別分析・上位下位分析（Phase 4B — F-TOP-01）
// 機能リスト「③個別分析-1 上位表示（10位）」「④個別分析-2 上位・下位分析」。
// 集計元は ReservationNight（計上日単位の実績明細）。
// 稼働率は利用人数別では出さない（F-ANA-01: 人数別は構成比・客単価。稼働率は非表示）。
// ======================================

/** 集計軸 → ReservationNight のカラム / セグメントマスタ種別の対応 */
const AXIS_CONFIG: Record<
  SegmentAxis,
  { field: keyof SegmentRow; kind: SegmentKind | null; label: string }
> = {
  roomType: { field: 'roomTypeCode', kind: null, label: '部屋タイプ別' },
  market: { field: 'marketCode', kind: SegmentKind.MARKET, label: '販路（マーケット）別' },
  region: { field: 'regionCode', kind: SegmentKind.REGION, label: '地域別' },
  agent: { field: 'agentCode', kind: SegmentKind.AGENT, label: 'エージェント別' },
  rateType: { field: 'rateTypeCode', kind: SegmentKind.RATE_TYPE, label: '料金タイプ別' },
  guests: { field: 'guestsBucket', kind: null, label: '利用人数別' },
  individualGroup: { field: 'individualGroupType', kind: null, label: '個人・団体別' },
}

export interface SegmentRow {
  roomTypeCode: string | null
  marketCode: string | null
  regionCode: string | null
  agentCode: string | null
  rateTypeCode: string | null
  individualGroupType: string | null
  guestsBucket: string | null
  rooms: number
  guests: number | null
  roomRevenue: number | null
}

export interface SegmentBucket {
  code: string
  name: string
  aggregateCode: string | null
  rooms: number
  guests: number
  revenue: number
  adr: number
  guestUnitPrice: number
  roomShare: number // 構成比（室数ベース — F-ANA-01）
  revenueShare: number
}

/** 利用人数を区分ラベルへ（1名/2名/3名以上 — F-DAILY-03 と同じ区分） */
export function guestsBucketOf(guests: number | null): string {
  if (guests == null || guests <= 0) return '不明'
  if (guests === 1) return '1名'
  if (guests === 2) return '2名'
  return '3名以上'
}

/**
 * 明細を指定軸で集計し、室数降順で返す。純関数（テスト対象）。
 */
export function aggregateBySegment(rows: SegmentRow[], axis: SegmentAxis): SegmentBucket[] {
  const field = AXIS_CONFIG[axis].field
  const map = new Map<string, SegmentBucket>()

  for (const row of rows) {
    const raw = row[field]
    const code = typeof raw === 'string' && raw.length > 0 ? raw : '不明'
    let b = map.get(code)
    if (!b) {
      b = {
        code,
        name: code,
        aggregateCode: null,
        rooms: 0,
        guests: 0,
        revenue: 0,
        adr: 0,
        guestUnitPrice: 0,
        roomShare: 0,
        revenueShare: 0,
      }
      map.set(code, b)
    }
    b.rooms += row.rooms
    b.guests += row.guests ?? 0
    b.revenue += row.roomRevenue ?? 0
  }

  const totalRooms = [...map.values()].reduce((s, b) => s + b.rooms, 0)
  const totalRevenue = [...map.values()].reduce((s, b) => s + b.revenue, 0)

  for (const b of map.values()) {
    b.adr = b.rooms > 0 ? Math.round(b.revenue / b.rooms) : 0
    b.guestUnitPrice = b.guests > 0 ? Math.round(b.revenue / b.guests) : 0
    b.roomShare = totalRooms > 0 ? Math.round((b.rooms / totalRooms) * 1000) / 1000 : 0
    b.revenueShare = totalRevenue > 0 ? Math.round((b.revenue / totalRevenue) * 1000) / 1000 : 0
    b.revenue = Math.round(b.revenue)
  }

  return [...map.values()].sort((a, b) => b.rooms - a.rooms)
}

function shiftYear(date: Date, years: number): Date {
  const d = toUtcDate(date)
  return new Date(Date.UTC(d.getUTCFullYear() + years, d.getUTCMonth(), d.getUTCDate()))
}

async function loadNights(hotelId: string, start: Date, end: Date): Promise<SegmentRow[]> {
  const rows = await prisma.reservationNight.findMany({
    where: { hotelId, stayDate: { gte: start, lte: end } },
    select: {
      roomTypeCode: true,
      marketCode: true,
      regionCode: true,
      agentCode: true,
      rateTypeCode: true,
      individualGroupType: true,
      rooms: true,
      guests: true,
      roomRevenue: true,
    },
  })
  return rows.map((r) => ({ ...r, guestsBucket: guestsBucketOf(r.guests) }))
}

/** セグメントマスタで表示名を補完する */
async function decorateNames(
  hotelId: string,
  axis: SegmentAxis,
  buckets: SegmentBucket[]
): Promise<SegmentBucket[]> {
  const kind = AXIS_CONFIG[axis].kind
  if (!kind) return buckets

  const masters = await prisma.segmentMaster.findMany({
    where: { hotelId, kind },
    select: { code: true, name: true, aggregateCode: true },
  })
  const byCode = new Map(masters.map((m) => [m.code, m]))
  return buckets.map((b) => {
    const m = byCode.get(b.code)
    return m ? { ...b, name: m.name, aggregateCode: m.aggregateCode } : b
  })
}

/**
 * セグメント別パフォーマンス（上位N — F-TOP-01）
 * compareLastYear=true で前年同期の順位・室数・売上差異を付ける。
 */
export async function getSegmentAnalysisService(input: SegmentAnalysisQueryInput) {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const start = toUtcDate(input.startDate)
  const end = toUtcDate(input.endDate)

  const rows = await loadNights(hotel.id, start, end)
  const all = await decorateNames(hotel.id, input.axis, aggregateBySegment(rows, input.axis))
  const top = all.slice(0, input.limit)

  let items: Array<
    SegmentBucket & {
      rank: number
      lastYear?: { rank: number | null; rooms: number; revenue: number } | null
      diff?: { rank: number | null; rooms: number; revenue: number } | null
    }
  > = top.map((b, i) => ({ ...b, rank: i + 1 }))

  if (input.compareLastYear) {
    const lyRows = await loadNights(hotel.id, shiftYear(start, -1), shiftYear(end, -1))
    const lyAll = aggregateBySegment(lyRows, input.axis)
    const lyByCode = new Map(lyAll.map((b, i) => [b.code, { ...b, rank: i + 1 }]))

    items = items.map((item) => {
      const ly = lyByCode.get(item.code)
      return {
        ...item,
        lastYear: ly ? { rank: ly.rank, rooms: ly.rooms, revenue: ly.revenue } : null,
        diff: ly
          ? {
              // 順位差異は「上がった分をプラス」にする（前年5位→今年2位なら +3）
              rank: ly.rank - item.rank,
              rooms: item.rooms - ly.rooms,
              revenue: item.revenue - ly.revenue,
            }
          : null,
      }
    })
  }

  return {
    hotelId: hotel.id,
    axis: input.axis,
    axisLabel: AXIS_CONFIG[input.axis].label,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    limit: input.limit,
    segmentCount: all.length,
    totals: {
      rooms: all.reduce((s, b) => s + b.rooms, 0),
      guests: all.reduce((s, b) => s + b.guests, 0),
      revenue: all.reduce((s, b) => s + b.revenue, 0),
    },
    items,
  }
}

/**
 * 上位・下位分析（日別ADR / 日別稼働率 — F-TOP-01）
 * 日次実績（DailyData）を用いる。
 */
export async function getDailyRankingService(input: RankingQueryInput) {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const start = toUtcDate(input.startDate)
  const end = toUtcDate(input.endDate)

  const days = await prisma.dailyData.findMany({
    where: { hotelId: hotel.id, date: { gte: start, lte: end } },
    select: { date: true, adr: true, occupancy: true, soldRooms: true, totalRevenue: true },
  })

  const valued = days
    .map((d) => ({
      date: d.date.toISOString().slice(0, 10),
      value: input.metric === 'adr' ? d.adr : d.occupancy,
      adr: d.adr,
      occupancy: d.occupancy,
      soldRooms: d.soldRooms,
      revenue: d.totalRevenue,
    }))
    .filter((d) => d.value != null) as Array<{
    date: string
    value: number
    adr: number | null
    occupancy: number | null
    soldRooms: number | null
    revenue: number | null
  }>

  const desc = [...valued].sort((a, b) => b.value - a.value)

  return {
    hotelId: hotel.id,
    metric: input.metric,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    dayCount: valued.length,
    top: desc.slice(0, input.limit),
    bottom: desc.slice(-input.limit).reverse(),
  }
}
