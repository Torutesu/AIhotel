// 評価の DB 連携: 学習済みスナップショット × 実績 から、アブレーション・要因別成績表・推奨効果を出す
import { prisma } from '../../lib/prisma.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'
import { toIsoDate } from '../signals/holidaySignal.js'
import { loadCoefficientMap } from './coefficients.js'
import { mapOccupancyToDemandLevel } from './ruleBasedForecaster.js'
import type { RecommendationExplanation } from './forecastService.js'
import {
  summarizeAblation,
  summarizeFactorScorecard,
  summarizeRecommendationEffect,
  type AblationRow,
  type EffectRow,
  type EffectSample,
  type EvaluationSample,
  type FactorScorecardRow,
} from './evaluation.js'

function addUtcDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

function today(): Date {
  const n = new Date()
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()))
}

/**
 * 実績が確定した宿泊日のスナップショット（各宿泊日について最も直近のリードタイム ≥ 1）を評価サンプルにする
 */
async function loadEvaluationSamples(hotelId: string, lookbackDays: number): Promise<EvaluationSample[]> {
  const end = addUtcDays(today(), -1)
  const start = addUtcDays(end, -lookbackDays)
  const [snapshots, actuals] = await Promise.all([
    prisma.forecastSnapshot.findMany({
      where: { hotelId, stayDate: { gte: start, lte: end }, leadDays: { gte: 1 } },
      orderBy: [{ stayDate: 'asc' }, { leadDays: 'asc' }],
      select: { stayDate: true, leadDays: true, predictedOccupancy: true, contributions: true },
    }),
    prisma.dailyData.findMany({ where: { hotelId, date: { gte: start, lte: end }, occupancy: { not: null } }, select: { date: true, occupancy: true } }),
  ])
  const actualByDate = new Map(actuals.map((a) => [toIsoDate(a.date), a.occupancy!]))
  const seen = new Set<string>()
  const samples: EvaluationSample[] = []
  for (const s of snapshots) {
    const key = toIsoDate(s.stayDate)
    if (seen.has(key)) continue
    const actual = actualByDate.get(key)
    if (actual == null) continue
    const ex = s.contributions as unknown as RecommendationExplanation | null
    if (!ex) continue
    seen.add(key)
    samples.push({
      stayDate: key,
      leadDays: s.leadDays,
      predictedOccupancy: s.predictedOccupancy,
      unconstrainedOccupancy: ex.unconstrainedOccupancy ?? s.predictedOccupancy,
      actualOccupancy: actual,
      demandFactors: ex.demandFactors ?? [],
    })
  }
  return samples
}

export interface FactorEvaluation {
  hotelId: string
  lookbackDays: number
  samples: number
  ablation: AblationRow[]
  scorecard: FactorScorecardRow[]
}

export async function getFactorEvaluationService(hotelId: string, lookbackDays = 180): Promise<FactorEvaluation> {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { id: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  const [samples, coefficients] = await Promise.all([loadEvaluationSamples(hotelId, lookbackDays), loadCoefficientMap(hotelId)])
  return {
    hotelId,
    lookbackDays,
    samples: samples.length,
    ablation: summarizeAblation(samples),
    scorecard: summarizeFactorScorecard(samples, coefficients),
  }
}

export interface RecommendationEffect {
  hotelId: string
  lookbackDays: number
  samples: number
  rows: EffectRow[]
  overall: EffectRow
  caveat: string
}

export async function getRecommendationEffectService(hotelId: string, lookbackDays = 90): Promise<RecommendationEffect> {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { id: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  const end = addUtcDays(today(), -1)
  const start = addUtcDays(end, -lookbackDays)
  const [actuals, decisions, snapshots] = await Promise.all([
    prisma.dailyData.findMany({ where: { hotelId, date: { gte: start, lte: end } }, select: { date: true, occupancy: true, adr: true, revPar: true } }),
    prisma.recommendationDecision.findMany({
      where: { hotelId, stayDate: { gte: start, lte: end } },
      orderBy: { createdAt: 'desc' },
      select: { stayDate: true, recommendedRank: true, appliedRank: true },
    }),
    prisma.forecastSnapshot.findMany({
      where: { hotelId, stayDate: { gte: start, lte: end }, leadDays: { gte: 1 } },
      orderBy: [{ stayDate: 'asc' }, { leadDays: 'asc' }],
      select: { stayDate: true, predictedOccupancy: true },
    }),
  ])
  const decisionByDate = new Map<string, { recommendedRank: number; appliedRank: number }>()
  for (const d of decisions) {
    const key = toIsoDate(d.stayDate)
    if (!decisionByDate.has(key)) decisionByDate.set(key, d)
  }
  const levelByDate = new Map<string, EffectSample['demandLevel']>()
  for (const s of snapshots) {
    const key = toIsoDate(s.stayDate)
    if (!levelByDate.has(key)) levelByDate.set(key, mapOccupancyToDemandLevel(s.predictedOccupancy))
  }
  const samples: EffectSample[] = []
  for (const a of actuals) {
    const key = toIsoDate(a.date)
    const level = levelByDate.get(key)
    if (!level) continue
    const d = decisionByDate.get(key)
    samples.push({
      stayDate: key,
      demandLevel: level,
      outcome: d ? (d.appliedRank === d.recommendedRank ? 'adopted' : 'overridden') : 'none',
      revPar: a.revPar,
      occupancy: a.occupancy,
      adr: a.adr,
    })
  }
  const { rows, overall } = summarizeRecommendationEffect(samples)
  return {
    hotelId,
    lookbackDays,
    samples: samples.length,
    rows,
    overall,
    caveat: '採用される日には偏りがあるため、同じ需要レベル帯の中での比較のみ意味があります。全体行は参考値です。',
  }
}
