import { prisma } from '../../lib/prisma.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'
import { getConsecutiveHolidayBlock, isJpHoliday } from '../../lib/jpHolidays.js'
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
  const holidayAdjustment = computeHolidayAdjustment(targetDate, weekendDays)

  const predictedOccupancy = computePredictedOccupancy({
    movingAverage,
    yearOverYear,
    eventImpact,
    weekendAdjustment,
    holidayAdjustment,
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

    const [dailyData, events, priceRanks] = await Promise.all([
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
    ])

    const history: OccupancyRecord[] = dailyData
      .filter((d): d is typeof d & { occupancy: number } => d.occupancy != null)
      .map((d) => ({ date: d.date, occupancy: d.occupancy }))

    const maxRank = priceRanks.length > 0 ? Math.max(...priceRanks.map((r) => r.rank)) : DEFAULT_MAX_RANK
    const priceByRank = new Map(priceRanks.map((r) => [r.rank, r.price1P]))

    const totalDays = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1
    const results: DailyForecast[] = []
    for (let i = 0; i < totalDays; i++) {
      const date = addUtcDays(startDate, i)
      const core = computeDailyForecastCore(date, history, events, weekendDays, maxRank)
      results.push({
        ...core,
        recommendedPrice: core.recommendedRank != null ? priceByRank.get(core.recommendedRank) ?? null : null,
        modelVersion: MODEL_VERSION,
      })
    }
    return results
  },
}
