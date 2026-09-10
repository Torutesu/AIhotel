// 継続学習の DB 連携（docs/外部要因設計.md §5）。
//   ForecastSnapshot（未学習）× DailyData（実績確定）→ 残差 → FactorCoefficient 更新 → learnedAt を記録
import { prisma } from '../../lib/prisma.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'
import { applyLearning, type CoefficientState, type LearningSample } from './learning.js'
import { toIsoDate } from '../signals/holidaySignal.js'
import type { RecommendationExplanation } from './forecastService.js'
import { estimateSigma, type ElasticitySample } from '../pricing/priceResponse.js'
import { getCoefficient } from './factorDefaults.js'

export interface LearnResult {
  hotelId: string
  tenantId: string
  samples: number
  updates: Array<{ key: string; before: number; after: number; sampleSize: number }>
  calibration: Array<{ bucket: string; before: number; after: number; samples: number }>
  /** 価格弾力性（σ）の学習結果。価格を動かした日が足りなければ null */
  elasticity: { before: number; after: number; estimated: number; samples: number } | null
}

function addUtcDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

/**
 * 実績が確定した宿泊日の未学習スナップショットから係数を更新する。冪等（学習済みは再利用しない）。
 * @param asOfDate 基準日。この日より前の宿泊日のみ対象（当日は実績未確定とみなす）
 */
export async function learnFromActualsService(hotelId: string, asOfDate?: Date, lookbackDays = 120): Promise<LearnResult> {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { id: true, tenantId: true } })
  if (!hotel) throw new NotFoundError('ホテル')

  const asOf = asOfDate ?? new Date()
  const end = addUtcDays(new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate())), -1)
  const start = addUtcDays(end, -lookbackDays)

  const [snapshots, actuals, coefRows, decisions, priceRanks] = await Promise.all([
    prisma.forecastSnapshot.findMany({
      where: { hotelId, learnedAt: null, stayDate: { gte: start, lte: end } },
      orderBy: [{ stayDate: 'asc' }, { asOfDate: 'asc' }],
      select: { id: true, stayDate: true, leadDays: true, predictedOccupancy: true, contributions: true },
    }),
    prisma.dailyData.findMany({
      where: { hotelId, date: { gte: start, lte: end }, occupancy: { not: null } },
      select: { date: true, occupancy: true },
    }),
    prisma.factorCoefficient.findMany({ where: { hotelId }, select: { factorKey: true, value: true, sampleSize: true } }),
    prisma.recommendationDecision.findMany({
      where: { hotelId, stayDate: { gte: start, lte: end } },
      orderBy: { createdAt: 'desc' },
      select: { stayDate: true, appliedRank: true },
    }),
    prisma.priceRank.findMany({ where: { hotelId, isActive: true }, select: { rank: true, price1P: true } }),
  ])
  const priceByRank = new Map(priceRanks.map((r) => [r.rank, r.price1P]))
  const appliedByDate = new Map<string, number>()
  for (const d of decisions) {
    const key = toIsoDate(d.stayDate)
    if (!appliedByDate.has(key)) appliedByDate.set(key, d.appliedRank)
  }

  const actualByDate = new Map(actuals.map((a) => [toIsoDate(a.date), a.occupancy!]))
  const samples: LearningSample[] = []
  const elasticitySamples: ElasticitySample[] = []
  const learnedIds: string[] = []
  const seenForElasticity = new Set<string>()
  for (const s of snapshots) {
    const actual = actualByDate.get(toIsoDate(s.stayDate))
    if (actual == null) continue // 実績未確定は次回に回す
    const explanation = s.contributions as unknown as RecommendationExplanation | null
    // 価格弾力性: 各宿泊日につき最も直近（リードタイム ≥1 の最小）のスナップショットと、実際に売ったランクの価格
    const dateKey = toIsoDate(s.stayDate)
    const applied = appliedByDate.get(dateKey)
    if (explanation && applied != null && s.leadDays >= 1 && !seenForElasticity.has(dateKey)) {
      const refPrice = priceByRank.get(explanation.baseRank)
      const appliedPrice = priceByRank.get(applied)
      if (refPrice && appliedPrice) {
        seenForElasticity.add(dateKey)
        elasticitySamples.push({ referencePrice: refPrice, referenceOccupancy: explanation.unconstrainedOccupancy ?? s.predictedOccupancy, appliedPrice, actualOccupancy: actual })
      }
    }
    samples.push({
      stayDate: toIsoDate(s.stayDate),
      leadDays: s.leadDays,
      predictedOccupancy: s.predictedOccupancy,
      actualOccupancy: actual,
      activeFactorKeys: explanation?.activeFactorKeys ?? [],
    })
    learnedIds.push(s.id)
  }

  const current = new Map<string, CoefficientState>(coefRows.map((r) => [r.factorKey, { value: r.value, sampleSize: r.sampleSize }]))
  const result = applyLearning(samples, current)

  // ---- 価格弾力性（σ）: 価格を基準から動かした日の実績で推定し、指数平滑で反映
  let elasticity: LearnResult['elasticity'] = null
  const sigmaEstimate = estimateSigma(elasticitySamples)
  if (sigmaEstimate) {
    const currentSigma = result.coefficients.get('price:sigma') ?? { value: getCoefficient(new Map(), 'price:sigma'), sampleSize: 0 }
    const lambda = Math.min(0.3, sigmaEstimate.samples / 20)
    const next = (1 - lambda) * currentSigma.value + lambda * sigmaEstimate.sigma
    result.coefficients.set('price:sigma', { value: Math.round(next * 1000) / 1000, sampleSize: currentSigma.sampleSize + sigmaEstimate.samples })
    elasticity = { before: currentSigma.value, after: Math.round(next * 1000) / 1000, estimated: sigmaEstimate.sigma, samples: sigmaEstimate.samples }
  }

  await prisma.$transaction(async (tx) => {
    for (const [key, state] of result.coefficients) {
      const before = current.get(key)
      if (before && before.value === state.value && before.sampleSize === state.sampleSize) continue
      await tx.factorCoefficient.upsert({
        where: { hotelId_factorKey: { hotelId, factorKey: key } },
        update: { value: state.value, sampleSize: state.sampleSize },
        create: { hotelId, tenantId: hotel.tenantId, factorKey: key, value: state.value, sampleSize: state.sampleSize },
      })
    }
    if (learnedIds.length > 0) {
      await tx.forecastSnapshot.updateMany({ where: { id: { in: learnedIds } }, data: { learnedAt: new Date() } })
    }
  })

  return {
    hotelId,
    tenantId: hotel.tenantId,
    samples: samples.length,
    updates: result.updates,
    calibration: result.calibration,
    elasticity,
  }
}

/**
 * 学習済み係数の一覧（初期値との差を UI で見せる用）
 */
export async function getCoefficientsService(hotelId: string) {
  return prisma.factorCoefficient.findMany({
    where: { hotelId },
    orderBy: { factorKey: 'asc' },
    select: { factorKey: true, value: true, sampleSize: true, updatedAt: true },
  })
}
