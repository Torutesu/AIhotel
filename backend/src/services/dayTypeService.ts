import { prisma } from '../lib/prisma.js'
import { addUtcDays, DEFAULT_WEEKEND_DAYS } from '../lib/date.js'
import { buildDayTypes, CURVE_GRID_LEADS, type DayCategory, type DayTypeHistoryDay, type DayTypeProfile } from './forecast/dayType.js'
import { isInRanges, PACE_MAX_CAPTURE_GAP_DAYS, type BookingCurvePoint, type DateRange } from './forecast/pace.js'
import { specialDayName } from './forecast/specialDays.js'
import { holidayRunOf } from '../lib/jpHolidays.js'
import { travelSeasonsOf } from '../lib/travelSeasons.js'
import { computeEventImpact } from './forecast/eventImpact.js'
import {
  clusterPickupCurves,
  pickupVector,
  predictFromNeighbors,
  PICKUP_MILESTONES,
  type DayContext,
  type PaceClustering,
  type PatternHistoryDay,
  type PatternPrediction,
  type PatternPredictInput,
  type WeatherClass,
} from './forecast/dayPattern.js'

// 日のタイプ（日のモデル）の材料を読み、型を作る（2026-10。判定は forecast/dayType.ts の純関数）。
// 料金カレンダー・日のAI分析・日のタイプ別パフォーマンス・需要予測（日ごとの優先モデル）が同じ型を使う。
// D-13: マイルストーン別のピックアップの型（clusterPickupCurves）と、日の背景（連休の並び・イベント・天気）が近い過去の日からの
// 着地の予測（predictFromNeighbors）も同じ材料から作る。

/** 型を作るのに使う過去の日数（季節をひと回り含める） */
export const DAY_TYPE_HISTORY_DAYS = 400

export interface DayTypeModel {
  types: DayTypeProfile[]
  /** 日の区分（特日・週末・平日） */
  categoryOf: (date: Date) => DayCategory
  /** その日の区分の型 */
  typesFor: (date: Date) => DayTypeProfile[]
  /** マイルストーン別のピックアップの型（D-13） */
  paceClustering: PaceClustering
  /** 日の背景。イベントは読み込んだ範囲（過去 DAY_TYPE_HISTORY_DAYS 日〜先 DAY_TYPE_FUTURE_DAYS 日）のもの */
  contextOf: (date: Date) => DayContext
  /** 背景と入り方が近い過去の日から着地を予測する。過去の日が足りなければ null */
  predict: (input: Omit<PatternPredictInput, 'context' | 'totalRooms'> & { date: Date }) => PatternPrediction | null
}

/** 先の日の背景に使うイベント・天気を読む範囲 */
export const DAY_TYPE_FUTURE_DAYS = 400

/** 気象庁の天気コード（例 "101"）を大分類にする */
export function weatherClassOf(code: string | null | undefined): WeatherClass | null {
  const head = Number(code?.charAt(0))
  return head >= 1 && head <= 4 ? (head as WeatherClass) : null
}

export function dayCategoryOf(date: Date, weekendDays: readonly number[], specialRanges: DateRange[]): DayCategory {
  if (specialDayName(date) != null || isInRanges(date, specialRanges)) return 'special'
  return weekendDays.includes(date.getUTCDay()) ? 'weekend' : 'weekday'
}

/** 型の典型カーブに使う予約積上の残日数（取り込みの間隔のずれを PACE_MAX_CAPTURE_GAP_DAYS まで許す） */
const CURVE_LEADS_TO_READ = [
  ...new Set(
    [...CURVE_GRID_LEADS, ...PICKUP_MILESTONES].flatMap((lead) =>
      Array.from({ length: PACE_MAX_CAPTURE_GAP_DAYS + 1 }, (_, i) => lead + i)
    )
  ),
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
  const until = addUtcDays(today, DAY_TYPE_FUTURE_DAYS)

  const [daily, events, curveRows, weatherRows] = await Promise.all([
    prisma.dailyData.findMany({
      where: { hotelId, date: { gte: from, lt: today } },
      select: { date: true, soldRooms: true, occupancy: true, adr: true },
    }),
    // イベント（日の背景）と特殊日（予測の基準から外す期間）。特殊日の過去は型の材料から外し、先の日は特日として扱う
    prisma.event.findMany({
      where: { hotelId, endDate: { gte: from }, startDate: { lte: until } },
      select: { startDate: true, endDate: true, expectedImpact: true, excludeFromHistory: true },
    }),
    prisma.bookingCurveData.findMany({
      where: { hotelId, stayDate: { gte: from, lt: today }, daysBefore: { in: CURVE_LEADS_TO_READ } },
      select: { stayDate: true, daysBefore: true, roomsBooked: true },
    }),
    // 天気（気象庁の予報 — D-13）。宿泊日ごとに最後に取った予報。過去の日は「前日までの予報」を天気の代わりに使う
    prisma.weatherForecast.findMany({
      where: { hotelId, date: { gte: from, lte: until } },
      select: { date: true, weatherCode: true },
    }),
  ])
  const specialEvents = events.filter((e) => e.excludeFromHistory)
  const weatherByDate = new Map(weatherRows.map((w) => [w.date.getTime(), weatherClassOf(w.weatherCode)]))
  const contextOf = (date: Date): DayContext => ({
    date,
    category: dayCategoryOf(date, weekendDays, specialEvents),
    eventImpact: computeEventImpact(events, date),
    holiday: holidayRunOf(date),
    seasons: travelSeasonsOf(date),
    weather: weatherByDate.get(date.getTime()) ?? null,
  })

  const curves = new Map<number, BookingCurvePoint[]>()
  for (const row of curveRows) {
    const key = row.stayDate.getTime()
    const list = curves.get(key) ?? []
    list.push(row)
    curves.set(key, list)
  }

  const history: DayTypeHistoryDay[] = []
  const patternHistory: PatternHistoryDay[] = []
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
    const points = curves.get(d.date.getTime()) ?? []
    patternHistory.push({
      context: contextOf(d.date),
      points,
      finalRooms,
      adr: d.adr,
      pickup: pickupVector(points, finalRooms, totalRooms),
      paceCluster: null,
    })
  }

  const types = buildDayTypes(history)
  const paceClustering = clusterPickupCurves(patternHistory.map((h) => h.pickup))
  paceClustering.assignments.forEach((id, i) => (patternHistory[i].paceCluster = id))
  const categoryOf = (date: Date) => dayCategoryOf(date, weekendDays, specialEvents)
  return {
    types,
    categoryOf,
    typesFor: (date: Date) => {
      const category = categoryOf(date)
      return types.filter((t) => t.category === category)
    },
    paceClustering,
    contextOf,
    predict: ({ date, ...rest }) => predictFromNeighbors({ ...rest, context: contextOf(date), totalRooms }, patternHistory),
  }
}
