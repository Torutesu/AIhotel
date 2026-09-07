import { prisma } from '../../lib/prisma.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'
import type { DailyForecast, DemandForecaster, ForecastDemandLevel, ForecastInput } from './types.js'
import { computeDemand } from './demandModel.js'
import { loadCoefficientMap } from './coefficients.js'
import { buildCurveFromHistory, projectOccupancyFromPace, DEFAULT_BOOKING_CURVE } from './bookingCurve.js'
import { computeHolidaySignal, toIsoDate } from '../signals/holidaySignal.js'
import { getWeatherSignalsService } from '../signals/signalService.js'

// ルールベース需要予測（F-DP-05。将来 ML モデルに差し替え予定）。
// 純粋ロジック（移動平均・閾値マッピング・イベント補正等）はテスト可能な
// 関数として分離し、forecast() はそれらを組み合わせて DB アクセスを行う。
// v2 では demandModel.ts が要因分解（ペース・祝日・天候・学習係数）を担い、
// このファイルの v1 関数は base の計算と互換ロジックとして残す。

export const MODEL_VERSION = 'rule-based-v2'
const DEFAULT_MAX_RANK = 40 // F-SET-02: 料金ランクは最大40段階（PriceRank未設定時のフォールバック）
const MOVING_AVERAGE_WINDOW_DAYS = 28
const YEAR_OVER_YEAR_TOLERANCE_DAYS = 3
const FALLBACK_OCCUPANCY = 0.6

// イベント影響度（pt = 稼働率への加算幅。0.15 = 15pt）
const EVENT_IMPACT_PT: Record<string, number> = {
  high: 0.15,
  medium: 0.08,
  low: 0.03,
}

// 週末補正（Hotel.weekendDays を参照 — ハードコード禁止）。
// 同曜日移動平均が既に週末パターンを反映しているため控えめな値とする
const WEEKEND_ADJUSTMENT_PT = 0.05

export interface OccupancyRecord {
  date: Date
  occupancy: number
}

export interface EventImpactRecord {
  startDate: Date
  endDate: Date
  expectedImpact?: string | null
  name?: string | null
}

/**
 * 直近28日の同曜日平均稼働率（移動平均）。データがなければ null
 */
export function computeMovingAverageBySameWeekday(
  history: OccupancyRecord[],
  targetDate: Date,
  windowDays = MOVING_AVERAGE_WINDOW_DAYS
): number | null {
  const targetDow = targetDate.getUTCDay()
  const windowStart = new Date(targetDate)
  windowStart.setUTCDate(windowStart.getUTCDate() - windowDays)

  const matches = history.filter(
    (h) => h.date >= windowStart && h.date < targetDate && h.date.getUTCDay() === targetDow
  )
  if (matches.length === 0) return null
  return matches.reduce((sum, m) => sum + m.occupancy, 0) / matches.length
}

/**
 * 前年同時期（±toleranceDays以内で最も近い日）の稼働率。データがなければ null
 */
export function computeYearOverYearOccupancy(
  history: OccupancyRecord[],
  targetDate: Date,
  toleranceDays = YEAR_OVER_YEAR_TOLERANCE_DAYS
): number | null {
  const lastYear = new Date(targetDate)
  lastYear.setUTCFullYear(lastYear.getUTCFullYear() - 1)

  let closest: { diffDays: number; occupancy: number } | null = null
  for (const h of history) {
    const diffDays = Math.abs(h.date.getTime() - lastYear.getTime()) / 86_400_000
    if (diffDays <= toleranceDays && (!closest || diffDays < closest.diffDays)) {
      closest = { diffDays, occupancy: h.occupancy }
    }
  }
  return closest?.occupancy ?? null
}

/**
 * 期間内イベントの影響度合計（expectedImpact: high=+15pt / medium=+8pt / low=+3pt）
 */
export function computeEventImpact(events: EventImpactRecord[], targetDate: Date): number {
  let impact = 0
  for (const e of events) {
    if (targetDate >= e.startDate && targetDate <= e.endDate) {
      const key = (e.expectedImpact ?? '').toLowerCase()
      impact += EVENT_IMPACT_PT[key] ?? 0
    }
  }
  return impact
}

/**
 * 週末補正（Hotel.weekendDays 準拠。デフォルト値のハードコード禁止のため呼び出し側で渡す）
 */
export function computeWeekendAdjustment(targetDate: Date, weekendDays: number[]): number {
  return weekendDays.includes(targetDate.getUTCDay()) ? WEEKEND_ADJUSTMENT_PT : 0
}

/**
 * 需要レベル5段階（A>0.9, B>0.8, C>0.65, D>0.5, それ以外E）
 */
export function mapOccupancyToDemandLevel(occupancy: number): ForecastDemandLevel {
  if (occupancy > 0.9) return 'A'
  if (occupancy > 0.8) return 'B'
  if (occupancy > 0.65) return 'C'
  if (occupancy > 0.5) return 'D'
  return 'E'
}

/**
 * 予測稼働率を料金ランク（1〜maxRank）にマップする
 */
export function mapOccupancyToRank(occupancy: number, maxRank = DEFAULT_MAX_RANK): number {
  const rank = Math.round(occupancy * maxRank)
  return Math.min(maxRank, Math.max(1, rank))
}

/**
 * 移動平均・前年同曜日比較・イベント補正・週末補正を合成して予測稼働率を算出する。
 * 移動平均と前年比較の両方があれば 0.7:0.3 で加重平均し、どちらか一方のみなら
 * それを採用、どちらもなければ FALLBACK_OCCUPANCY を基準値とする。
 */
export function computePredictedOccupancy(params: {
  movingAverage: number | null
  yearOverYear: number | null
  eventImpact: number
  weekendAdjustment: number
  fallback?: number
}): number {
  const { movingAverage, yearOverYear, eventImpact, weekendAdjustment, fallback = FALLBACK_OCCUPANCY } = params

  let base: number
  if (movingAverage != null && yearOverYear != null) {
    base = movingAverage * 0.7 + yearOverYear * 0.3
  } else if (movingAverage != null) {
    base = movingAverage
  } else if (yearOverYear != null) {
    base = yearOverYear
  } else {
    base = fallback
  }

  const predicted = base + eventImpact + weekendAdjustment
  return Math.min(1, Math.max(0, Math.round(predicted * 1000) / 1000))
}

/**
 * 予測の確信度（利用できたデータソースが多いほど高い）
 */
export function computeConfidence(params: { movingAverage: number | null; yearOverYear: number | null }): number {
  if (params.movingAverage != null && params.yearOverYear != null) return 0.85
  if (params.movingAverage != null) return 0.7
  if (params.yearOverYear != null) return 0.6
  return 0.4
}

/**
 * 単一日の予測を合成する（DB非依存の純粋ロジック）
 */
export function computeDailyForecastCore(
  targetDate: Date,
  history: OccupancyRecord[],
  events: EventImpactRecord[],
  weekendDays: number[],
  maxRank = DEFAULT_MAX_RANK
): Omit<DailyForecast, 'recommendedPrice' | 'modelVersion'> {
  const movingAverage = computeMovingAverageBySameWeekday(history, targetDate)
  const yearOverYear = computeYearOverYearOccupancy(history, targetDate)
  const eventImpact = computeEventImpact(events, targetDate)
  const weekendAdjustment = computeWeekendAdjustment(targetDate, weekendDays)

  const predictedOccupancy = computePredictedOccupancy({
    movingAverage,
    yearOverYear,
    eventImpact,
    weekendAdjustment,
  })

  return {
    date: targetDate,
    predictedOccupancy,
    demandLevel: mapOccupancyToDemandLevel(predictedOccupancy),
    recommendedRank: mapOccupancyToRank(predictedOccupancy, maxRank),
    confidence: computeConfidence({ movingAverage, yearOverYear }),
  }
}

function addUtcDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

export const ruleBasedForecaster: DemandForecaster = {
  name: MODEL_VERSION,

  async forecast(input: ForecastInput): Promise<DailyForecast[]> {
    const { hotelId, startDate, endDate } = input
    const asOf = input.asOfDate ?? new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()))

    const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
    if (!hotel) throw new NotFoundError('ホテル')
    const weekendDays = Array.isArray(hotel.weekendDays) ? (hotel.weekendDays as number[]) : [5, 6]

    // 移動平均(28日) + 前年同曜日比較(365日) の両方を賄えるだけ過去に遡って実績を取得。
    // 基準日より後の実績は使わない（バックテスト時のリーク防止）
    const historyWindowStart = addUtcDays(startDate, -400)
    const historyEnd = startDate < asOf ? startDate : asOf

    const [dailyData, events, priceRanks, coefficients, weather, curveRows, pastCurveRows] = await Promise.all([
      prisma.dailyData.findMany({
        where: { hotelId, date: { gte: historyWindowStart, lt: historyEnd }, occupancy: { not: null } },
        select: { date: true, occupancy: true },
        orderBy: { date: 'asc' },
      }),
      // 需要予測に使うのは承認済み（confirmed）のイベントのみ。候補・却下は使わない
      prisma.event.findMany({
        where: { hotelId, status: 'confirmed', startDate: { lte: endDate }, endDate: { gte: startDate } },
        select: { startDate: true, endDate: true, expectedImpact: true, name: true },
      }),
      prisma.priceRank.findMany({ where: { hotelId, isActive: true }, orderBy: { rank: 'asc' } }),
      loadCoefficientMap(hotelId),
      getWeatherSignalsService(hotelId, startDate, endDate),
      // 対象期間の OTB（基準日時点で観測済みのもの = daysBefore >= リードタイム）
      prisma.bookingCurveData.findMany({
        where: { hotelId, stayDate: { gte: startDate, lte: endDate } },
        select: { stayDate: true, daysBefore: true, roomsBooked: true },
      }),
      // 典型積上率曲線用の過去実績（最終値 daysBefore=0 を持つ宿泊日）
      prisma.bookingCurveData.findMany({
        where: { hotelId, stayDate: { gte: addUtcDays(asOf, -180), lt: asOf } },
        select: { stayDate: true, daysBefore: true, roomsBooked: true },
      }),
    ])

    const history: OccupancyRecord[] = dailyData
      .filter((d): d is typeof d & { occupancy: number } => d.occupancy != null)
      .map((d) => ({ date: d.date, occupancy: d.occupancy }))

    const maxRank = priceRanks.length > 0 ? Math.max(...priceRanks.map((r) => r.rank)) : DEFAULT_MAX_RANK
    const priceByRank = new Map(priceRanks.map((r) => [r.rank, r.price1P]))

    const { curve, samples } = buildCurveFromHistory(pastCurveRows)
    const usedDefaultCurve = curve === DEFAULT_BOOKING_CURVE || samples === 0
    const curveByStay = new Map<string, { daysBefore: number; roomsBooked: number }[]>()
    for (const row of curveRows) {
      const key = toIsoDate(row.stayDate)
      const list = curveByStay.get(key) ?? []
      list.push({ daysBefore: row.daysBefore, roomsBooked: row.roomsBooked })
      curveByStay.set(key, list)
    }

    const totalDays = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1
    const results: DailyForecast[] = []
    for (let i = 0; i < totalDays; i++) {
      const date = addUtcDays(startDate, i)
      const key = toIsoDate(date)
      const leadDays = Math.max(0, Math.round((date.getTime() - asOf.getTime()) / 86_400_000))

      // 基準日時点で観測できる最新の OTB（daysBefore >= leadDays のうち最小）
      const observations = (curveByStay.get(key) ?? []).filter((o) => o.daysBefore >= leadDays).sort((a, b) => a.daysBefore - b.daysBefore)
      const latest = observations[0]
      const pace =
        latest && hotel.totalRooms > 0
          ? {
              roomsOnBooks: latest.roomsBooked,
              daysBefore: latest.daysBefore,
              projectedOccupancy: projectOccupancyFromPace({
                roomsOnBooks: latest.roomsBooked,
                daysBefore: latest.daysBefore,
                totalRooms: hotel.totalRooms,
                curve,
              }),
              usedDefaultCurve,
            }
          : null

      const demand = computeDemand({
        targetDate: date,
        leadDays,
        history,
        events,
        weekendDays,
        holiday: computeHolidaySignal(date),
        weather: weather[key] ?? null,
        pace,
        coefficients,
      })
      const baseRank = mapOccupancyToRank(demand.predictedOccupancy, maxRank)
      results.push({
        date,
        predictedOccupancy: demand.predictedOccupancy,
        demandLevel: demand.demandLevel,
        recommendedRank: baseRank,
        recommendedPrice: priceByRank.get(baseRank) ?? null,
        confidence: demand.confidence.scalar,
        modelVersion: MODEL_VERSION,
        demand,
      })
    }
    return results
  },
}
