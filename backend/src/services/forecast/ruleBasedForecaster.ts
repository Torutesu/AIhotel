import { prisma } from '../../lib/prisma.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'
import type { DailyForecast, DemandForecaster, ForecastDemandLevel, ForecastInput } from './types.js'
import {
  OCCUPANCY_ONLY_WEIGHTS,
  applyRankGuardrails,
  blendRanksByStrategy,
  computeAdrRank,
  computeBaseAdr,
  computeCompetitorRank,
  computePredictedAdr,
  resolveCompetitorOccupancy,
  type AdrRecord,
  type CompetitorPriceRecord,
  type RankGuardrails,
  type RankPrice,
  type StrategyWeights,
} from './strategyWeighting.js'
import { RATIONALE_VERSION, type RationaleV1 } from './rationale.js'
import { DEFAULT_WEEKEND_DAYS, addUtcDays } from '../../lib/date.js'

// ルールベース需要予測（F-DP-05 の前段。将来 ML モデルに差し替え予定）。
// 純粋ロジック（移動平均・閾値マッピング・イベント補正等）はテスト可能な
// 関数として分離し、forecast() はそれらを組み合わせて DB アクセスを行う。
//
// v2 での変更（F-DP-02 の接続 — #76）:
// 推奨ランクを予測稼働率のみから決めるのをやめ、PricingStrategyConfig の重み
// （稼働率 / ADR / 競合）で3観点を加重平均するようにした。需要レベル（A〜E）は
// 「需要の大きさ」を表す指標であり価格戦略とは独立させるため、従来どおり予測
// 稼働率のみから判定する。
//
// v3 での変更（#17）: 競合観点の比較人数・相対ポジション・48時間より古い競合価格の除外、
// ガードレール（ランクの下限・上限、1回の変動幅、ヒステリシス）、推奨を固定する期間、
// 推奨理由（#24 E4）の出力を加えた。
export const MODEL_VERSION = 'rule-based-v3'
// ガードレールの既定値（設定を保存していないホテル向け。PricingStrategyConfig の列の既定値と揃える — #17）
const DEFAULT_MAX_DAILY_RANK_CHANGE = 3
const DEFAULT_HYSTERESIS_RANKS = 1
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
): Omit<DailyForecast, 'recommendedPrice' | 'predictedAdr' | 'modelVersion'> {
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

export const ruleBasedForecaster: DemandForecaster = {
  name: MODEL_VERSION,

  async forecast(input: ForecastInput): Promise<DailyForecast[]> {
    const { hotelId, startDate, endDate } = input

    const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, isActive: true } })
    if (!hotel) throw new NotFoundError('ホテル')
    const weekendDays = Array.isArray(hotel.weekendDays)
      ? (hotel.weekendDays as number[])
      : [...DEFAULT_WEEKEND_DAYS]

    // 移動平均(28日) + 前年同曜日比較(365日) の両方を賄えるだけ過去に遡って実績を取得
    const historyWindowStart = addUtcDays(startDate, -400)

    const [dailyData, events, priceRanks, strategyConfig, competitorPrices, previous] = await Promise.all([
      prisma.dailyData.findMany({
        where: {
          hotelId,
          date: { gte: historyWindowStart, lt: startDate },
        },
        select: { date: true, occupancy: true, adr: true },
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
      prisma.pricingStrategyConfig.findUnique({ where: { hotelId } }),
      // 対象期間の競合価格。論理削除した競合は含めない（#90）
      prisma.competitorPriceData.findMany({
        where: {
          competitor: { hotelId, isActive: true },
          date: { gte: startDate, lte: endDate },
        },
        select: { date: true, price1P: true, price2P: true, observedAt: true, updatedAt: true },
      }),
      // 前回の推奨（ガードレールの基準 — #17）
      prisma.aiPriceRecommendation.findMany({
        where: { hotelId, roomTypeId: null, date: { gte: startDate, lte: endDate } },
        select: { date: true, recommendedRank: true },
      }),
    ])

    const history: OccupancyRecord[] = dailyData
      .filter((d): d is typeof d & { occupancy: number } => d.occupancy != null)
      .map((d) => ({ date: d.date, occupancy: d.occupancy }))

    const adrHistory: AdrRecord[] = dailyData
      .filter((d): d is typeof d & { adr: number } => d.adr != null)
      .map((d) => ({ date: d.date, adr: d.adr }))

    // 競合と自館を同じ人数の料金で比べる（#17）
    const competitorOccupancy = resolveCompetitorOccupancy(strategyConfig?.competitorOccupancy, hotel.hotelType)
    const competitorHistory: CompetitorPriceRecord[] = competitorPrices.flatMap((c) => {
      const price = competitorOccupancy === 2 ? c.price2P : c.price1P
      return price == null ? [] : [{ date: c.date, price, observedAt: c.observedAt ?? c.updatedAt }]
    })

    const maxRank = priceRanks.length > 0 ? Math.max(...priceRanks.map((r) => r.rank)) : DEFAULT_MAX_RANK
    const priceByRank = new Map(priceRanks.map((r) => [r.rank, r.price1P]))
    const rankPrices: RankPrice[] = priceRanks.map((r) => ({ rank: r.rank, price: r.price1P }))
    const competitorRankPrices: RankPrice[] =
      competitorOccupancy === 2 ? priceRanks.map((r) => ({ rank: r.rank, price: r.price2P })) : rankPrices
    const previousRankByDate = new Map(
      previous.filter((p) => p.recommendedRank != null).map((p) => [p.date.getTime(), p.recommendedRank as number])
    )

    // 戦略設定が無いホテルは従来どおり稼働率のみで決定する
    const weights: StrategyWeights = strategyConfig
      ? {
          weightOccupancy: strategyConfig.weightOccupancy,
          weightAdr: strategyConfig.weightAdr,
          weightCompetitor: strategyConfig.weightCompetitor,
        }
      : OCCUPANCY_ONLY_WEIGHTS
    const guardrails: RankGuardrails = {
      minRank: strategyConfig?.minRank ?? null,
      maxRank: strategyConfig?.maxRank ?? null,
      maxDailyRankChange: strategyConfig ? strategyConfig.maxDailyRankChange : DEFAULT_MAX_DAILY_RANK_CHANGE,
      hysteresisRanks: strategyConfig?.hysteresisRanks ?? DEFAULT_HYSTERESIS_RANKS,
    }
    const now = new Date()

    const totalDays = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1
    const results: DailyForecast[] = []
    for (let i = 0; i < totalDays; i++) {
      const date = addUtcDays(startDate, i)
      const core = computeDailyForecastCore(date, history, events, weekendDays, maxRank)

      const baseAdr = computeBaseAdr(adrHistory, date)
      const adrRank = computeAdrRank(adrHistory, date, rankPrices)
      const competitor = computeCompetitorRank(competitorHistory, date, competitorRankPrices, {
        offsetPct: strategyConfig?.competitorOffsetPct ?? 0,
        now,
      })

      const blended = blendRanksByStrategy({
        occupancyRank: core.recommendedRank ?? 1,
        adrRank,
        competitorRank: competitor.rank,
        weights,
        maxRank,
      })
      const guarded = applyRankGuardrails({
        rank: blended.rank,
        previousRank: previousRankByDate.get(date.getTime()) ?? null,
        guardrails,
        maxRank,
      })

      results.push({
        ...core,
        recommendedRank: guarded.rank,
        recommendedPrice: priceByRank.get(guarded.rank) ?? null,
        // 予測ADRは着地シミュレーション（F-DP-04）とダッシュボードの予測ADR系列の元になる。
        // 書き込まないと再計算のたびに消え、着地が1名料金ベースで過小になっていた（#77）
        predictedAdr: computePredictedAdr({ baseAdr, recommendedRank: guarded.rank, ranks: rankPrices }),
        modelVersion: MODEL_VERSION,
        rationale: buildRationale({
          date,
          core,
          blended,
          guarded,
          weights,
          baseAdr,
          adrRank,
          competitor,
          competitorOccupancy,
          offsetPct: strategyConfig?.competitorOffsetPct ?? 0,
          events,
          weekendDays,
        }),
      })
    }
    return results
  },
}

/** 推奨理由（#24 E4）を組み立てる。計算の途中結果を捨てずに残すだけで、値は変えない */
function buildRationale(params: {
  date: Date
  core: ReturnType<typeof computeDailyForecastCore>
  blended: ReturnType<typeof blendRanksByStrategy>
  guarded: ReturnType<typeof applyRankGuardrails>
  weights: StrategyWeights
  baseAdr: number | null
  adrRank: number | null
  competitor: ReturnType<typeof computeCompetitorRank>
  competitorOccupancy: 1 | 2
  offsetPct: number
  events: EventImpactRecord[]
  weekendDays: number[]
}): RationaleV1 {
  const { blended, weights, competitor } = params
  const factors: RationaleV1['factors'] = [
    {
      key: 'occupancy',
      rank: blended.components.occupancy,
      weight: blended.effectiveWeights.weightOccupancy,
      input: { predictedOccupancy: params.core.predictedOccupancy },
    },
  ]
  const excluded: RationaleV1['excluded'] = []

  if (blended.components.adr != null) {
    factors.push({
      key: 'adr',
      rank: blended.components.adr,
      weight: blended.effectiveWeights.weightAdr,
      input: { baseAdr: params.baseAdr == null ? null : Math.round(params.baseAdr), windowDays: 28 },
    })
  } else {
    excluded.push({ key: 'adr', reason: weights.weightAdr === 0 ? 'zero_weight' : 'no_data' })
  }

  if (blended.components.competitor != null) {
    factors.push({
      key: 'competitor',
      rank: blended.components.competitor,
      weight: blended.effectiveWeights.weightCompetitor,
      input: {
        median: competitor.median == null ? null : Math.round(competitor.median),
        count: competitor.count,
        occupancy: params.competitorOccupancy,
        offsetPct: params.offsetPct,
        observedAt: competitor.observedAt?.toISOString() ?? null,
      },
    })
  } else {
    excluded.push({
      key: 'competitor',
      reason: weights.weightCompetitor === 0 ? 'zero_weight' : (competitor.excluded ?? 'no_data'),
    })
  }

  const adjustments: RationaleV1['adjustments'] = []
  const eventImpact = computeEventImpact(params.events, params.date)
  if (eventImpact !== 0) adjustments.push({ key: 'event', impact: eventImpact })
  const weekendImpact = computeWeekendAdjustment(params.date, params.weekendDays)
  if (weekendImpact !== 0) adjustments.push({ key: 'weekend', impact: weekendImpact })

  return {
    version: RATIONALE_VERSION,
    modelVersion: MODEL_VERSION,
    recommendedRank: params.guarded.rank,
    factors,
    adjustments,
    excluded,
    guardrails: params.guarded.applied,
  }
}
