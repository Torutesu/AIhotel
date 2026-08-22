import { prisma } from '../../lib/prisma.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'
import { getConsecutiveHolidayBlock, isJpHoliday } from '../../lib/jpHolidays.js'
import {
  DEFAULT_STRATEGY_WEIGHTS,
  selectRecommendedRank,
  type StrategyWeights,
} from './rankOptimizer.js'
import type { DailyForecast, DemandForecaster, ForecastDemandLevel, ForecastInput } from './types.js'

// ルールベース需要予測（F-DP-05 の前段。将来 ML モデルに差し替え予定）。
// v1.5: 祝日・連休補正、予測区間ベースの確信度、価格戦略の重み接続を追加
// （docs/algorithm-design.md §5 の v1.5 スコープ）。
// 純粋ロジック（移動平均・閾値マッピング・イベント補正等）はテスト可能な
// 関数として分離し、forecast() はそれらを組み合わせて DB アクセスを行う。

export const MODEL_VERSION = 'rule-based-v1.5'
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

// 祝日補正（P-9）。翌日が祝日の夜は宿泊需要が高い（翌日が休みなので泊まれる）。
// 3連休以上の中日はさらに高い。値は v2 で学習ベース（f_holiday）に置き換える暫定値
const HOLIDAY_EVE_ADJUSTMENT_PT = 0.05
const LONG_HOLIDAY_ADJUSTMENT_PT = 0.05

// 予測区間（P-7）: 同曜日実績のばらつきから80%区間を正規近似で作る。
// z(90%)=1.28。ばらつきが計算できない場合は既定幅にフォールバック。
// v2 で conformal prediction による較正済み区間に置き換える
const INTERVAL_Z80 = 1.28
const INTERVAL_MIN_HALF_WIDTH = 0.03
const INTERVAL_MAX_HALF_WIDTH = 0.3
const INTERVAL_FALLBACK_HALF_WIDTH_PARTIAL = 0.12 // データが薄い（同曜日<3件 or 前年のみ）
const INTERVAL_FALLBACK_HALF_WIDTH_NONE = 0.2 // 参照データなし

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
 * 直近windowDays以内の同曜日実績値のリスト（移動平均と予測区間の共通材料）
 */
export function getSameWeekdayValues(
  history: OccupancyRecord[],
  targetDate: Date,
  windowDays = MOVING_AVERAGE_WINDOW_DAYS
): number[] {
  const targetDow = targetDate.getUTCDay()
  const windowStart = new Date(targetDate)
  windowStart.setUTCDate(windowStart.getUTCDate() - windowDays)

  return history
    .filter((h) => h.date >= windowStart && h.date < targetDate && h.date.getUTCDay() === targetDow)
    .map((h) => h.occupancy)
}

/**
 * 直近28日の同曜日平均稼働率（移動平均）。データがなければ null
 */
export function computeMovingAverageBySameWeekday(
  history: OccupancyRecord[],
  targetDate: Date,
  windowDays = MOVING_AVERAGE_WINDOW_DAYS
): number | null {
  const values = getSameWeekdayValues(history, targetDate, windowDays)
  if (values.length === 0) return null
  return values.reduce((sum, v) => sum + v, 0) / values.length
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
 * 祝日・連休補正（P-9 / docs/algorithm-design.md §3.4）。
 * - 翌日が祝日の夜: +5pt（宿泊できる夜）。ただし weekendDays に含まれる曜日は
 *   週末補正と二重加算になるため加算しない
 * - 3連休以上の中の泊まれる夜（連休最終日以外）: さらに +5pt
 * 祝日データのカバー範囲外の年は補正なし（jpHolidays 側で判定）
 */
export function computeHolidayAdjustment(targetDate: Date, weekendDays: number[]): number {
  let adjustment = 0

  const nextDay = new Date(targetDate)
  nextDay.setUTCDate(nextDay.getUTCDate() + 1)
  if (isJpHoliday(nextDay) && !weekendDays.includes(targetDate.getUTCDay())) {
    adjustment += HOLIDAY_EVE_ADJUSTMENT_PT
  }

  const block = getConsecutiveHolidayBlock(targetDate)
  if (block && block.length >= 3 && block.position < block.length) {
    adjustment += LONG_HOLIDAY_ADJUSTMENT_PT
  }

  return adjustment
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
  holidayAdjustment?: number
  fallback?: number
}): number {
  const {
    movingAverage,
    yearOverYear,
    eventImpact,
    weekendAdjustment,
    holidayAdjustment = 0,
    fallback = FALLBACK_OCCUPANCY,
  } = params

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

  const predicted = base + eventImpact + weekendAdjustment + holidayAdjustment
  return Math.min(1, Math.max(0, Math.round(predicted * 1000) / 1000))
}

/**
 * 80%予測区間（P10/P90）。同曜日実績のばらつき（不偏標準偏差）から正規近似で作る（P-7）。
 * 同曜日実績が3件未満のときは既定幅にフォールバックする
 */
export function computePredictionInterval(params: {
  predicted: number
  sameWeekdayValues: number[]
  yearOverYear: number | null
}): { p10: number; p90: number } {
  const { predicted, sameWeekdayValues, yearOverYear } = params
  const n = sameWeekdayValues.length

  let halfWidth: number
  if (n >= 3) {
    const mean = sameWeekdayValues.reduce((s, v) => s + v, 0) / n
    const variance = sameWeekdayValues.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)
    const sigma = Math.sqrt(variance)
    halfWidth = Math.min(INTERVAL_MAX_HALF_WIDTH, Math.max(INTERVAL_MIN_HALF_WIDTH, INTERVAL_Z80 * sigma))
  } else if (n > 0 || yearOverYear != null) {
    halfWidth = INTERVAL_FALLBACK_HALF_WIDTH_PARTIAL
  } else {
    halfWidth = INTERVAL_FALLBACK_HALF_WIDTH_NONE
  }

  return {
    p10: Math.max(0, Math.round((predicted - halfWidth) * 1000) / 1000),
    p90: Math.min(1, Math.round((predicted + halfWidth) * 1000) / 1000),
  }
}

/**
 * 予測の確信度（P-7: 80%予測区間の幅から導出。区間が狭いほど高い）。
 * データソースが欠けている場合は上限を絞り、高い確信度を主張しない。
 * 従来のデータソース数のみによる定数（0.85/0.7/0.6/0.4）を置き換えるもの
 */
export function computeConfidence(params: {
  intervalWidth: number
  movingAverage: number | null
  yearOverYear: number | null
}): number {
  const { intervalWidth, movingAverage, yearOverYear } = params

  let confidence = 1 - intervalWidth * 2
  if (movingAverage == null && yearOverYear == null) {
    confidence = Math.min(confidence, 0.4)
  } else if (movingAverage == null || yearOverYear == null) {
    confidence = Math.min(confidence, 0.7)
  }

  return Math.min(0.95, Math.max(0.2, Math.round(confidence * 100) / 100))
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
  const sameWeekdayValues = getSameWeekdayValues(history, targetDate)
  const movingAverage =
    sameWeekdayValues.length > 0
      ? sameWeekdayValues.reduce((s, v) => s + v, 0) / sameWeekdayValues.length
      : null
  const yearOverYear = computeYearOverYearOccupancy(history, targetDate)
  const eventImpact = computeEventImpact(events, targetDate)
  const weekendAdjustment = computeWeekendAdjustment(targetDate, weekendDays)
  const holidayAdjustment = computeHolidayAdjustment(targetDate, weekendDays)

  const predictedOccupancy = computePredictedOccupancy({
    movingAverage,
    yearOverYear,
    eventImpact,
    weekendAdjustment,
    holidayAdjustment,
  })

  const { p10, p90 } = computePredictionInterval({
    predicted: predictedOccupancy,
    sameWeekdayValues,
    yearOverYear,
  })

  return {
    date: targetDate,
    predictedOccupancy,
    predictedOccupancyP10: p10,
    predictedOccupancyP90: p90,
    demandLevel: mapOccupancyToDemandLevel(predictedOccupancy),
    recommendedRank: mapOccupancyToRank(predictedOccupancy, maxRank),
    confidence: computeConfidence({ intervalWidth: p90 - p10, movingAverage, yearOverYear }),
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

    const [dailyData, events, priceRanks, strategyConfig, competitorPrices] = await Promise.all([
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
      // 価格戦略の重み（F-DP-02）。未設定ならスキーマ既定値と同じ 40/40/20
      prisma.pricingStrategyConfig.findUnique({ where: { hotelId } }),
      // 競合平均価格（競合追従スコア用）。対象期間分のみ
      prisma.competitorPriceData.findMany({
        where: { date: { gte: startDate, lte: endDate }, competitor: { hotelId, isActive: true } },
        select: { date: true, price1P: true },
      }),
    ])

    const history: OccupancyRecord[] = dailyData
      .filter((d): d is typeof d & { occupancy: number } => d.occupancy != null)
      .map((d) => ({ date: d.date, occupancy: d.occupancy }))

    const maxRank = priceRanks.length > 0 ? Math.max(...priceRanks.map((r) => r.rank)) : DEFAULT_MAX_RANK
    const priceByRank = new Map(priceRanks.map((r) => [r.rank, r.price1P]))

    const weights: StrategyWeights = strategyConfig
      ? {
          weightOccupancy: strategyConfig.weightOccupancy,
          weightAdr: strategyConfig.weightAdr,
          weightCompetitor: strategyConfig.weightCompetitor,
        }
      : DEFAULT_STRATEGY_WEIGHTS

    // 競合平均価格（日別）
    const competitorPricesByDate = new Map<string, number[]>()
    for (const cp of competitorPrices) {
      if (cp.price1P == null) continue
      const key = cp.date.toISOString().slice(0, 10)
      const list = competitorPricesByDate.get(key) ?? []
      list.push(cp.price1P)
      competitorPricesByDate.set(key, list)
    }

    const totalDays = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1
    const results: DailyForecast[] = []
    for (let i = 0; i < totalDays; i++) {
      const date = addUtcDays(startDate, i)
      const core = computeDailyForecastCore(date, history, events, weekendDays, maxRank)

      // 価格戦略の重みでベースライン近傍を再スコアリング（P-2 / F-DP-02）
      const dateKey = date.toISOString().slice(0, 10)
      const dayCompetitorPrices = competitorPricesByDate.get(dateKey)
      const competitorAvgPrice =
        dayCompetitorPrices && dayCompetitorPrices.length > 0
          ? dayCompetitorPrices.reduce((a, b) => a + b, 0) / dayCompetitorPrices.length
          : null
      const selected =
        core.recommendedRank != null
          ? selectRecommendedRank({
              baselineRank: core.recommendedRank,
              predictedOccupancy: core.predictedOccupancy,
              priceByRank,
              weights,
              competitorAvgPrice,
              maxRank,
            })
          : null

      results.push({
        ...core,
        recommendedRank: selected?.rank ?? core.recommendedRank,
        recommendedPrice: selected?.price ?? null,
        modelVersion: MODEL_VERSION,
      })
    }
    return results
  },
}
