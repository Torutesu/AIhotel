import { prisma } from '../../lib/prisma.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'
import type { DemandLevel, Prisma } from '@prisma/client'
import type { DailyForecast, DemandForecaster } from './types.js'
import { resolveForecaster } from './ridgeForecaster.js'
import { decideRank, type RankContribution } from '../pricing/rankDecision.js'
import { loadCoefficientMap } from './coefficients.js'
import { getCoefficient } from './factorDefaults.js'
import { toIsoDate } from '../signals/holidaySignal.js'
import type { DemandFactor } from './demandModel.js'
import { getAppliedRanksService, getCompetitorMedianPricesService } from '../pricing/marketContext.js'

export { getAppliedRanksService, getCompetitorMedianPricesService }

// 需要予測の再計算・DB反映（F-DP-05）。docs/外部要因設計.md §2, §4。
//   需要予測層（forecaster）→ 価格決定層（decideRank）→ AiPriceRecommendation（最新値）
//   ＋ ForecastSnapshot（基準日ごとの不変記録。学習・バックテスト・差分表示の元）
// F-DP-03（AI予測値へのリセット）のバックエンドとしても機能する:
// 手動で価格ランクを編集した後でも、このサービスを呼べば AiPriceRecommendation が
// 最新の予測で上書きされ、AI推奨値に戻せる。

const DEFAULT_FORECAST_DAYS = 90
const DEFAULT_WEIGHTS = { weightOccupancy: 40, weightAdr: 40, weightCompetitor: 20 }
const DEFAULT_GUARDRAILS = { minRank: 1, maxRank: 40, maxDailyRankChange: 5, competitorPositionPct: 0 }

function addUtcDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

export function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/** AiPriceRecommendation.contributions / ForecastSnapshot に保存する理由分解の形（API がそのまま返す） */
export interface RecommendationExplanation {
  modelVersion: string
  asOfDate: string
  leadDays: number
  demandFactors: DemandFactor[]
  activeFactorKeys: string[]
  unconstrainedOccupancy: number
  baseRank: number
  revenueOptimalRank: number
  candidates: { occupancy: number; adr: number; competitor: number | null }
  priceContributions: RankContribution[]
  comparisonRank: number
  expectedOccupancyRecommended: number
  confidence: { p10: number; p50: number; p90: number; leadBucket: string }
}

/**
 * ホテル全体（roomTypeId=null）の AiPriceRecommendation を1件アップサートする。
 *
 * @@unique([hotelId, date, roomTypeId]) は roomTypeId が NULL の場合、
 * SQL の仕様上 NULL 同士は等しいとみなされないため、Prisma の
 * upsert(where: { hotelId_date_roomTypeId: { ..., roomTypeId: null } }) は
 * 使用できない（実行時に "Argument roomTypeId must not be null" で拒否される）。
 * そのため findFirst → create/update による手動アップサートで対応する。
 */
async function upsertHotelWideRecommendation(
  hotelId: string,
  tenantId: string,
  date: Date,
  data: Omit<Prisma.AiPriceRecommendationUncheckedCreateInput, 'hotelId' | 'tenantId' | 'date' | 'roomTypeId'>
): Promise<void> {
  const existing = await prisma.aiPriceRecommendation.findFirst({
    where: { hotelId, date, roomTypeId: null },
    select: { id: true },
  })
  if (existing) {
    await prisma.aiPriceRecommendation.update({ where: { id: existing.id }, data })
  } else {
    await prisma.aiPriceRecommendation.create({ data: { hotelId, tenantId, date, ...data } })
  }
}

export interface RecomputeForecastResult {
  count: number
  modelVersion: string
  tenantId: string
  startDate: string
  endDate: string
  asOfDate: string
}

/**
 * 需要予測を再計算し、価格決定層を通して AiPriceRecommendation と ForecastSnapshot に反映する。
 * @param forecaster 差し替え可能な予測実装（デフォルトはルールベース v2）
 */
export async function recomputeForecastService(
  hotelId: string,
  startDate?: Date,
  endDate?: Date,
  forecasterOverride?: DemandForecaster,
  asOfDate?: Date
): Promise<RecomputeForecastResult> {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')
  // 稼働中モデル（Hotel.activeForecaster）を使う。バックテスト等は明示的に差し替える
  const forecaster = forecasterOverride ?? resolveForecaster(hotel.activeForecaster)

  const asOf = dateOnly(asOfDate ?? new Date())
  const start = dateOnly(startDate ?? asOf)
  const end = dateOnly(endDate ?? addUtcDays(start, DEFAULT_FORECAST_DAYS))

  const [strategy, priceRanks, coefficients, appliedRanks, competitorMedians, previousRecs, forecasts] = await Promise.all([
    prisma.pricingStrategyConfig.findUnique({ where: { hotelId } }),
    prisma.priceRank.findMany({ where: { hotelId, isActive: true }, orderBy: { rank: 'asc' }, select: { rank: true, price1P: true } }),
    loadCoefficientMap(hotelId),
    getAppliedRanksService(hotelId, start, end),
    getCompetitorMedianPricesService(hotelId, start, end),
    prisma.aiPriceRecommendation.findMany({
      where: { hotelId, roomTypeId: null, date: { gte: start, lte: end } },
      select: { date: true, recommendedRank: true },
    }),
    forecaster.forecast({ hotelId, startDate: start, endDate: end, asOfDate: asOf }),
  ])

  const weights = strategy ?? DEFAULT_WEIGHTS
  const guardrails = {
    minRank: strategy?.minRank ?? DEFAULT_GUARDRAILS.minRank,
    maxRank: strategy?.maxRank ?? DEFAULT_GUARDRAILS.maxRank,
    maxDailyRankChange: strategy?.maxDailyRankChange ?? DEFAULT_GUARDRAILS.maxDailyRankChange,
    competitorPositionPct: strategy?.competitorPositionPct ?? DEFAULT_GUARDRAILS.competitorPositionPct,
  }
  const previousRankByDate = new Map(previousRecs.map((r) => [toIsoDate(r.date), r.recommendedRank]))
  const priceByRank = new Map(priceRanks.map((r) => [r.rank, r.price1P]))
  const sigma = getCoefficient(coefficients, 'price:sigma')
  const occTol = getCoefficient(coefficients, 'strategy:occ_revpar_tolerance')
  const adrTol = getCoefficient(coefficients, 'strategy:adr_revpar_tolerance')

  for (const forecast of forecasts) {
    const key = toIsoDate(forecast.date)
    const record = buildRecommendationRecord(forecast, {
      priceRanks,
      priceByRank,
      weights,
      guardrails,
      competitorMedianPrice: competitorMedians.get(key) ?? null,
      currentRank: appliedRanks.get(key) ?? null,
      previousRecommendedRank: previousRankByDate.get(key) ?? null,
      sigma,
      occTol,
      adrTol,
      asOf,
    })

    await upsertHotelWideRecommendation(hotelId, hotel.tenantId, forecast.date, {
      predictedOccupancy: record.predictedOccupancy,
      recommendedRank: record.recommendedRank,
      recommendedPrice: record.recommendedPrice,
      demandLevel: forecast.demandLevel as DemandLevel,
      confidence: forecast.confidence,
      modelVersion: forecast.modelVersion,
      computedAt: new Date(),
      contributions: record.explanation as unknown as Prisma.InputJsonValue,
      expectedRevParCurrent: record.expectedRevParCurrent,
      expectedRevParRecommended: record.expectedRevParRecommended,
    })

    if (forecast.demand && record.recommendedRank != null) {
      const recommendedRank = record.recommendedRank
      await prisma.forecastSnapshot.upsert({
        where: { hotelId_stayDate_asOfDate: { hotelId, stayDate: forecast.date, asOfDate: asOf } },
        update: {
          leadDays: forecast.demand.leadDays,
          predictedOccupancy: record.predictedOccupancy,
          recommendedRank,
          currentRank: appliedRanks.get(key) ?? null,
          demandFactors: forecast.demand.demandFactors as unknown as Prisma.InputJsonValue,
          contributions: record.explanation as unknown as Prisma.InputJsonValue,
          expectedRevParCurrent: record.expectedRevParCurrent,
          expectedRevParRecommended: record.expectedRevParRecommended,
          confidence: record.explanation.confidence as unknown as Prisma.InputJsonValue,
          modelVersion: forecast.modelVersion,
        },
        create: {
          hotelId,
          tenantId: hotel.tenantId,
          stayDate: forecast.date,
          asOfDate: asOf,
          leadDays: forecast.demand.leadDays,
          predictedOccupancy: record.predictedOccupancy,
          recommendedRank,
          currentRank: appliedRanks.get(key) ?? null,
          demandFactors: forecast.demand.demandFactors as unknown as Prisma.InputJsonValue,
          contributions: record.explanation as unknown as Prisma.InputJsonValue,
          expectedRevParCurrent: record.expectedRevParCurrent,
          expectedRevParRecommended: record.expectedRevParRecommended,
          confidence: record.explanation.confidence as unknown as Prisma.InputJsonValue,
          modelVersion: forecast.modelVersion,
        },
      })
    }
  }

  return {
    count: forecasts.length,
    modelVersion: forecaster.name,
    tenantId: hotel.tenantId,
    startDate: toIsoDate(start),
    endDate: toIsoDate(end),
    asOfDate: toIsoDate(asOf),
  }
}

interface RecordContext {
  priceRanks: { rank: number; price1P: number }[]
  priceByRank: Map<number, number>
  weights: { weightOccupancy: number; weightAdr: number; weightCompetitor: number }
  guardrails: { minRank: number; maxRank: number; maxDailyRankChange: number | null; competitorPositionPct: number }
  competitorMedianPrice: number | null
  currentRank: number | null
  previousRecommendedRank: number | null
  sigma: number
  occTol: number
  adrTol: number
  asOf: Date
}

interface RecommendationRecord {
  predictedOccupancy: number
  recommendedRank: number | null
  recommendedPrice: number | null
  expectedRevParCurrent: number | null
  expectedRevParRecommended: number | null
  explanation: RecommendationExplanation
}

/**
 * 需要予測 1 日分を価格決定層に通し、保存用レコードに変換する（純粋ロジック）
 */
export function buildRecommendationRecord(forecast: DailyForecast, ctx: RecordContext): RecommendationRecord {
  const demand = forecast.demand
  if (!demand || ctx.priceRanks.length === 0) {
    // v1 互換（要因分解なし）: 予測実装が返した基準ランクをそのまま使う
    return {
      predictedOccupancy: forecast.predictedOccupancy,
      recommendedRank: forecast.recommendedRank,
      recommendedPrice: forecast.recommendedPrice,
      expectedRevParCurrent: null,
      expectedRevParRecommended: null,
      explanation: {
        modelVersion: forecast.modelVersion,
        asOfDate: toIsoDate(ctx.asOf),
        leadDays: 0,
        demandFactors: [],
        activeFactorKeys: [],
        unconstrainedOccupancy: forecast.predictedOccupancy,
        baseRank: forecast.recommendedRank ?? 0,
        revenueOptimalRank: forecast.recommendedRank ?? 0,
        candidates: { occupancy: forecast.recommendedRank ?? 0, adr: forecast.recommendedRank ?? 0, competitor: null },
        priceContributions: [],
        comparisonRank: forecast.recommendedRank ?? 0,
        expectedOccupancyRecommended: forecast.predictedOccupancy,
        confidence: { p10: forecast.predictedOccupancy, p50: forecast.predictedOccupancy, p90: forecast.predictedOccupancy, leadBucket: 'unknown' },
      },
    }
  }

  const decision = decideRank({
    predictedOccupancy: demand.predictedOccupancy,
    unconstrainedOccupancy: demand.unconstrainedOccupancy,
    ranks: ctx.priceRanks,
    weights: ctx.weights,
    guardrails: ctx.guardrails,
    competitorMedianPrice: ctx.competitorMedianPrice,
    currentRank: ctx.currentRank,
    previousRecommendedRank: ctx.previousRecommendedRank,
    sigma: ctx.sigma,
    occupancyRevParTolerance: ctx.occTol,
    adrRevParTolerance: ctx.adrTol,
  })

  return {
    predictedOccupancy: demand.predictedOccupancy,
    recommendedRank: decision.rank,
    recommendedPrice: ctx.priceByRank.get(decision.rank) ?? null,
    expectedRevParCurrent: decision.expectedRevParCurrent,
    expectedRevParRecommended: decision.expectedRevParRecommended,
    explanation: {
      modelVersion: forecast.modelVersion,
      asOfDate: toIsoDate(ctx.asOf),
      leadDays: demand.leadDays,
      demandFactors: demand.demandFactors,
      activeFactorKeys: demand.activeFactorKeys,
      unconstrainedOccupancy: demand.unconstrainedOccupancy,
      baseRank: decision.baseRank,
      revenueOptimalRank: decision.revenueOptimalRank,
      candidates: decision.candidates,
      priceContributions: decision.contributions,
      comparisonRank: decision.comparisonRank,
      expectedOccupancyRecommended: decision.expectedOccupancyRecommended,
      confidence: {
        p10: demand.confidence.p10,
        p50: demand.confidence.p50,
        p90: demand.confidence.p90,
        leadBucket: demand.confidence.leadBucket,
      },
    },
  }
}
