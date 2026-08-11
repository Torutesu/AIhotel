import { prisma } from '../../lib/prisma.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'
import type { DailyForecast, DemandForecaster, ForecastDemandLevel, ForecastInput } from './types.js'

// ルールベース需要予測（F-DP-05 の前段。将来 ML モデルに差し替え予定）。
// 純粋ロジック（移動平均・閾値マッピング・イベント補正等）はテスト可能な
// 関数として分離し、forecast() はそれらを組み合わせて DB アクセスを行う。

export const MODEL_VERSION = 'rule-based-v1'
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
 * 予測稼働率を料金ランクのはしご位置（0〜rankCount-1）にマップする。
 * はしごは価格の安い順（sortOrder昇順）に並んでいる前提で、
 * 稼働率が高いほど高価格側のランクを選ぶ。
 */
export function selectRankIndex(occupancy: number, rankCount: number): number {
  if (rankCount <= 0) return 0
  const index = Math.round(occupancy * (rankCount - 1))
  return Math.min(rankCount - 1, Math.max(0, index))
}

/** 料金ランクのはしご1段分（価格の安い順に並べたもの） */
export interface RankLadderEntry {
  rankCode: string
  sortOrder: number
  price: number
}

/**
 * 予測稼働率から推奨ランクを選ぶ（F-DP-05）。
 * ランクマスタ未整備時は null を返し、推奨価格も出さない。
 */
export function selectRankByOccupancy(
  occupancy: number,
  ladder: RankLadderEntry[]
): RankLadderEntry | null {
  if (ladder.length === 0) return null
  return ladder[selectRankIndex(occupancy, ladder.length)]
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
  weekendDays: number[]
): Omit<DailyForecast, 'recommendedPrice' | 'recommendedRank' | 'recommendedRankCode' | 'modelVersion'> {
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
      // ホテル全体の推奨は「マスタ先頭の部屋タイプ × 自社レート」のはしごを基準にする
      // （部屋タイプ別の推奨は roomTypeId 付きレコードで別途扱う）
      prisma.priceRank.findMany({
        where: { hotelId, isActive: true, rateCategory: 'OWN' },
        orderBy: [{ roomType: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
        select: { rankCode: true, sortOrder: true, price: true, roomTypeId: true },
      }),
    ])

    const history: OccupancyRecord[] = dailyData
      .filter((d): d is typeof d & { occupancy: number } => d.occupancy != null)
      .map((d) => ({ date: d.date, occupancy: d.occupancy }))

    // 先頭の部屋タイプ分だけをはしごとして使う（価格の安い順）
    const baseRoomTypeId = priceRanks[0]?.roomTypeId
    const ladder: RankLadderEntry[] = priceRanks
      .filter((r) => r.roomTypeId === baseRoomTypeId)
      .map((r) => ({ rankCode: r.rankCode, sortOrder: r.sortOrder, price: r.price }))

    const totalDays = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1
    const results: DailyForecast[] = []
    for (let i = 0; i < totalDays; i++) {
      const date = addUtcDays(startDate, i)
      const core = computeDailyForecastCore(date, history, events, weekendDays)
      const rank = selectRankByOccupancy(core.predictedOccupancy, ladder)
      results.push({
        ...core,
        recommendedRank: rank?.sortOrder ?? null,
        recommendedRankCode: rank?.rankCode ?? null,
        recommendedPrice: rank?.price ?? null,
        modelVersion: MODEL_VERSION,
      })
    }
    return results
  },
}
