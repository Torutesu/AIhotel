import { prisma } from '../../lib/prisma.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'
import type { DailyForecast, DemandForecaster, ForecastDemandLevel, ForecastInput } from './types.js'

// ルールベース需要予測（F-DP-05 の前段。将来 ML モデルに差し替え予定）。
// 純粋ロジック（移動平均・閾値マッピング・イベント補正等）はテスト可能な
// 関数として分離し、forecast() はそれらを組み合わせて DB アクセスを行う。

export const MODEL_VERSION = 'rule-based-v1'
const DEFAULT_MAX_RANK = 40 // F-SET-02: 料金ランクは最大40段階（PriceRank未設定時のフォールバック）
const YEAR_OVER_YEAR_TOLERANCE_DAYS = 3

/**
 * 予測モデルパラメータ。ホテル×年の ForecastModelConfig（year=0 はホテルのデフォルト）で
 * 上書きできる（「場所や年でロジックが変わる」要件）。未設定時は組み込みデフォルト値を使う。
 */
export interface ForecastModelParams {
  movingAverageWindowDays: number
  /** 移動平均の重み（残り 1-w は前年同時期） */
  movingAverageWeight: number
  /** イベント影響度（pt = 稼働率への加算幅。0.15 = 15pt） */
  eventImpactHighPt: number
  eventImpactMediumPt: number
  eventImpactLowPt: number
  /**
   * 週末補正（Hotel.weekendDays を参照 — ハードコード禁止）。
   * 同曜日移動平均が既に週末パターンを反映しているため控えめな値とする
   */
  weekendAdjustmentPt: number
  fallbackOccupancy: number
}

export const DEFAULT_FORECAST_MODEL_PARAMS: ForecastModelParams = {
  movingAverageWindowDays: 28,
  movingAverageWeight: 0.7,
  eventImpactHighPt: 0.15,
  eventImpactMediumPt: 0.08,
  eventImpactLowPt: 0.03,
  weekendAdjustmentPt: 0.05,
  fallbackOccupancy: 0.6,
}

export interface OccupancyRecord {
  date: Date
  occupancy: number
}

export interface EventImpactRecord {
  startDate: Date
  endDate: Date
  expectedImpact?: string | null
}

/**
 * 直近28日の同曜日平均稼働率（移動平均）。データがなければ null
 */
export function computeMovingAverageBySameWeekday(
  history: OccupancyRecord[],
  targetDate: Date,
  windowDays = DEFAULT_FORECAST_MODEL_PARAMS.movingAverageWindowDays
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
 * 期間内イベントの影響度合計（デフォルト: high=+15pt / medium=+8pt / low=+3pt）
 */
export function computeEventImpact(
  events: EventImpactRecord[],
  targetDate: Date,
  params: ForecastModelParams = DEFAULT_FORECAST_MODEL_PARAMS
): number {
  const impactPt: Record<string, number> = {
    high: params.eventImpactHighPt,
    medium: params.eventImpactMediumPt,
    low: params.eventImpactLowPt,
  }
  let impact = 0
  for (const e of events) {
    if (targetDate >= e.startDate && targetDate <= e.endDate) {
      const key = (e.expectedImpact ?? '').toLowerCase()
      impact += impactPt[key] ?? 0
    }
  }
  return impact
}

/**
 * 週末補正（Hotel.weekendDays 準拠。デフォルト値のハードコード禁止のため呼び出し側で渡す）
 */
export function computeWeekendAdjustment(
  targetDate: Date,
  weekendDays: number[],
  adjustmentPt = DEFAULT_FORECAST_MODEL_PARAMS.weekendAdjustmentPt
): number {
  return weekendDays.includes(targetDate.getUTCDay()) ? adjustmentPt : 0
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
 * 移動平均と前年比較の両方があれば movingAverageWeight : (1 - movingAverageWeight) で
 * 加重平均（デフォルト 0.7:0.3）し、どちらか一方のみならそれを採用、
 * どちらもなければ fallback（デフォルト fallbackOccupancy = 0.6）を基準値とする。
 */
export function computePredictedOccupancy(params: {
  movingAverage: number | null
  yearOverYear: number | null
  eventImpact: number
  weekendAdjustment: number
  fallback?: number
  movingAverageWeight?: number
}): number {
  const {
    movingAverage,
    yearOverYear,
    eventImpact,
    weekendAdjustment,
    fallback = DEFAULT_FORECAST_MODEL_PARAMS.fallbackOccupancy,
    movingAverageWeight = DEFAULT_FORECAST_MODEL_PARAMS.movingAverageWeight,
  } = params

  let base: number
  if (movingAverage != null && yearOverYear != null) {
    base = movingAverage * movingAverageWeight + yearOverYear * (1 - movingAverageWeight)
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
  maxRank = DEFAULT_MAX_RANK,
  params: ForecastModelParams = DEFAULT_FORECAST_MODEL_PARAMS
): Omit<DailyForecast, 'recommendedPrice' | 'modelVersion'> {
  const movingAverage = computeMovingAverageBySameWeekday(history, targetDate, params.movingAverageWindowDays)
  const yearOverYear = computeYearOverYearOccupancy(history, targetDate)
  const eventImpact = computeEventImpact(events, targetDate, params)
  const weekendAdjustment = computeWeekendAdjustment(targetDate, weekendDays, params.weekendAdjustmentPt)

  const predictedOccupancy = computePredictedOccupancy({
    movingAverage,
    yearOverYear,
    eventImpact,
    weekendAdjustment,
    fallback: params.fallbackOccupancy,
    movingAverageWeight: params.movingAverageWeight,
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

    const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
    if (!hotel) throw new NotFoundError('ホテル')
    const weekendDays = Array.isArray(hotel.weekendDays) ? (hotel.weekendDays as number[]) : [5, 6]

    // 移動平均(28日) + 前年同曜日比較(365日) の両方を賄えるだけ過去に遡って実績を取得
    const historyWindowStart = addUtcDays(startDate, -400)

    const [dailyData, events, priceRanks, modelConfigs] = await Promise.all([
      prisma.dailyData.findMany({
        where: {
          hotelId,
          date: { gte: historyWindowStart, lt: startDate },
          occupancy: { not: null },
        },
        select: { date: true, occupancy: true },
        orderBy: { date: 'asc' },
      }),
      prisma.event.findMany({
        where: { hotelId, startDate: { lte: endDate }, endDate: { gte: startDate } },
        select: { startDate: true, endDate: true, expectedImpact: true },
      }),
      prisma.priceRank.findMany({
        where: { hotelId, isActive: true },
        orderBy: { rank: 'asc' },
      }),
      prisma.forecastModelConfig.findMany({ where: { hotelId } }),
    ])

    // 対象年の設定 → year=0（ホテルデフォルト） → 組み込みデフォルトの順に解決
    const paramsByYear = new Map<number, ForecastModelParams>(
      modelConfigs.map((c) => [
        c.year,
        {
          movingAverageWindowDays: c.movingAverageWindowDays,
          movingAverageWeight: c.movingAverageWeight,
          eventImpactHighPt: c.eventImpactHighPt,
          eventImpactMediumPt: c.eventImpactMediumPt,
          eventImpactLowPt: c.eventImpactLowPt,
          weekendAdjustmentPt: c.weekendAdjustmentPt,
          fallbackOccupancy: c.fallbackOccupancy,
        },
      ])
    )
    const resolveParams = (date: Date): ForecastModelParams =>
      paramsByYear.get(date.getUTCFullYear()) ?? paramsByYear.get(0) ?? DEFAULT_FORECAST_MODEL_PARAMS

    const history: OccupancyRecord[] = dailyData
      .filter((d): d is typeof d & { occupancy: number } => d.occupancy != null)
      .map((d) => ({ date: d.date, occupancy: d.occupancy }))

    const maxRank = priceRanks.length > 0 ? Math.max(...priceRanks.map((r) => r.rank)) : DEFAULT_MAX_RANK
    const priceByRank = new Map(priceRanks.map((r) => [r.rank, r.price1P]))

    const totalDays = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1
    const results: DailyForecast[] = []
    for (let i = 0; i < totalDays; i++) {
      const date = addUtcDays(startDate, i)
      const core = computeDailyForecastCore(date, history, events, weekendDays, maxRank, resolveParams(date))
      results.push({
        ...core,
        recommendedPrice: core.recommendedRank != null ? priceByRank.get(core.recommendedRank) ?? null : null,
        modelVersion: MODEL_VERSION,
      })
    }
    return results
  },
}
