import { prisma } from '../lib/prisma.js'
import { addUtcDays, DEFAULT_WEEKEND_DAYS } from '../lib/date.js'
import { buildDayTypes, CURVE_GRID_LEADS, type DayCategory, type DayTypeHistoryDay, type DayTypeProfile } from './forecast/dayType.js'
import { isInRanges, PACE_MAX_CAPTURE_GAP_DAYS, type BookingCurvePoint, type DateRange } from './forecast/pace.js'
import { specialDayName } from './forecast/specialDays.js'

// 日のタイプ（日のモデル）の材料を読み、型を作る（2026-10。判定は forecast/dayType.ts の純関数）。
// 料金カレンダー・日のAI分析・日のタイプ別パフォーマンス・需要予測（日ごとの優先モデル）が同じ型を使う。

/** 型を作るのに使う過去の日数（季節をひと回り含める） */
export const DAY_TYPE_HISTORY_DAYS = 400

export interface DayTypeModel {
  types: DayTypeProfile[]
  /** 日の区分（特日・週末・平日） */
  categoryOf: (date: Date) => DayCategory
  /** その日の区分の型 */
  typesFor: (date: Date) => DayTypeProfile[]
}

export function dayCategoryOf(date: Date, weekendDays: readonly number[], specialRanges: DateRange[]): DayCategory {
  if (specialDayName(date) != null || isInRanges(date, specialRanges)) return 'special'
  return weekendDays.includes(date.getUTCDay()) ? 'weekend' : 'weekday'
}

/** 型の典型カーブに使う予約積上の残日数（取り込みの間隔のずれを PACE_MAX_CAPTURE_GAP_DAYS まで許す） */
const CURVE_LEADS_TO_READ = [
  ...new Set(CURVE_GRID_LEADS.flatMap((lead) => Array.from({ length: PACE_MAX_CAPTURE_GAP_DAYS + 1 }, (_, i) => lead + i))),
]

/**
 * ホテルの日のタイプを作る。過去 DAY_TYPE_HISTORY_DAYS 日の結果（特殊日のイベントの日は除く）と、その宿泊日の予約積上を使う
 * @param today 今日（JST の日付）。今日より前の結果だけを使う
 */
export async function loadDayTypeModel(hotelId: string, today: Date): Promise<DayTypeModel> {
  const hotel = await prisma.hotel.findFirst({
    where: { id: hotelId, isActive: true },
    select: { totalRooms: true, weekendDays: true },
  })
  const totalRooms = hotel?.totalRooms ?? 0
  const weekendDays = Array.isArray(hotel?.weekendDays) ? (hotel.weekendDays as number[]) : [...DEFAULT_WEEKEND_DAYS]
  const from = addUtcDays(today, -DAY_TYPE_HISTORY_DAYS)

  const [daily, specialEvents, curveRows] = await Promise.all([
    prisma.dailyData.findMany({
      where: { hotelId, date: { gte: from, lt: today } },
      select: { date: true, soldRooms: true, occupancy: true, adr: true },
    }),
    // 特殊日（予測の基準から外す期間）。過去は型の材料から外し、先の日は特日として扱う
    prisma.event.findMany({
      where: { hotelId, excludeFromHistory: true, endDate: { gte: from } },
      select: { startDate: true, endDate: true },
    }),
    prisma.bookingCurveData.findMany({
      where: { hotelId, stayDate: { gte: from, lt: today }, daysBefore: { in: CURVE_LEADS_TO_READ } },
      select: { stayDate: true, daysBefore: true, roomsBooked: true },
    }),
  ])

  const curves = new Map<number, BookingCurvePoint[]>()
  for (const row of curveRows) {
    const key = row.stayDate.getTime()
    const list = curves.get(key) ?? []
    list.push(row)
    curves.set(key, list)
  }

  const history: DayTypeHistoryDay[] = []
  for (const d of daily) {
    if (isInRanges(d.date, specialEvents)) continue
    const finalRooms = d.soldRooms ?? (d.occupancy != null && totalRooms > 0 ? Math.round(d.occupancy * totalRooms) : null)
    const occupancy = d.occupancy ?? (finalRooms != null && totalRooms > 0 ? finalRooms / totalRooms : null)
    if (finalRooms == null || occupancy == null) continue
    history.push({
      date: d.date,
      category: dayCategoryOf(d.date, weekendDays, specialEvents),
      occupancy: Math.min(1, occupancy),
      adr: d.adr,
      finalRooms,
      points: curves.get(d.date.getTime()) ?? [],
    })
  }

  const types = buildDayTypes(history)
  const categoryOf = (date: Date) => dayCategoryOf(date, weekendDays, specialEvents)
  return {
    types,
    categoryOf,
    typesFor: (date: Date) => {
      const category = categoryOf(date)
      return types.filter((t) => t.category === category)
    },
  }
}
