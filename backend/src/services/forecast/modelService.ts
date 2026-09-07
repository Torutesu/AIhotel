// チャンピオン/チャレンジャー運用（docs/外部要因設計.md §5.3）。
//   train:   学習済みスナップショット（実績あり）から ridge-v1 の十分統計量を再構築
//   compare: 稼働中モデルとチャレンジャーをバックテストで比較
//   promote: バックテストで全区分 baseline 以上、かつ稼働中モデル以上のときだけ Hotel.activeForecaster を切替
import { prisma } from '../../lib/prisma.js'
import type { Prisma } from '@prisma/client'
import { BadRequestError, NotFoundError } from '../../middlewares/errorHandler.js'
import { addSample, buildFeatures, emptyRidgeState } from './ridge.js'
import { RIDGE_MODEL_VERSION, resolveForecaster } from './ridgeForecaster.js'
import { runBacktestService, BACKTEST_TOLERANCE, type BacktestResult } from './backtestService.js'
import { toIsoDate } from '../signals/holidaySignal.js'
import type { RecommendationExplanation } from './forecastService.js'
import { MODEL_VERSION as RULE_MODEL_VERSION } from './ruleBasedForecaster.js'

export const AVAILABLE_MODELS = [RULE_MODEL_VERSION, RIDGE_MODEL_VERSION] as const

export interface TrainResult {
  hotelId: string
  tenantId: string
  modelName: string
  samples: number
  trainedAt: string
}

/**
 * ridge-v1 を学習する。実績が確定したスナップショット（リードタイム 1〜30 日）の要因分解を特徴量に、
 * 実績稼働率を目的変数にして十分統計量を作り直す（冪等: 毎回ゼロから再構築）
 */
export async function trainModelService(hotelId: string, modelName: string = RIDGE_MODEL_VERSION, lookbackDays = 365): Promise<TrainResult> {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { tenantId: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  if (modelName !== RIDGE_MODEL_VERSION) throw new BadRequestError(`${modelName} は学習対象ではありません（ルールベースは係数学習 /pricing/learn を使います）`)

  const today = new Date()
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - lookbackDays)

  const [snapshots, actuals] = await Promise.all([
    prisma.forecastSnapshot.findMany({
      where: { hotelId, stayDate: { gte: start, lt: end }, leadDays: { gte: 1, lte: 30 } },
      select: { stayDate: true, contributions: true },
    }),
    prisma.dailyData.findMany({ where: { hotelId, date: { gte: start, lt: end }, occupancy: { not: null } }, select: { date: true, occupancy: true } }),
  ])
  const actualByDate = new Map(actuals.map((a) => [toIsoDate(a.date), a.occupancy!]))

  let state = emptyRidgeState()
  for (const s of snapshots) {
    const actual = actualByDate.get(toIsoDate(s.stayDate))
    const explanation = s.contributions as unknown as RecommendationExplanation | null
    if (actual == null || !explanation?.demandFactors?.length) continue
    // ridge 自身の補正は特徴に含めない（自己参照を避ける）
    const factors = explanation.demandFactors.filter((f) => f.key !== 'model:ridge')
    state = addSample(state, buildFeatures(factors, s.stayDate.getUTCDay()), actual)
  }

  const trainedAt = new Date()
  await prisma.forecastModelState.upsert({
    where: { hotelId_modelName: { hotelId, modelName } },
    update: { state: state as unknown as Prisma.InputJsonValue, samples: state.samples, trainedAt },
    create: { hotelId, tenantId: hotel.tenantId, modelName, state: state as unknown as Prisma.InputJsonValue, samples: state.samples, trainedAt },
  })
  return { hotelId, tenantId: hotel.tenantId, modelName, samples: state.samples, trainedAt: trainedAt.toISOString() }
}

export interface ModelComparison {
  hotelId: string
  activeForecaster: string
  results: BacktestResult[]
  /** 各チャレンジャーが昇格条件を満たすか */
  promotable: Record<string, { ok: boolean; reason: string }>
  states: Array<{ modelName: string; samples: number; trainedAt: string }>
}

function meetsGate(candidate: BacktestResult, champion: BacktestResult): { ok: boolean; reason: string } {
  if (candidate.samples === 0) return { ok: false, reason: 'バックテストのサンプルがありません' }
  if (!candidate.beatsBaseline) return { ok: false, reason: '要因なし（base のみ）より精度が低い区分があります' }
  for (const c of candidate.summary) {
    const ch = champion.summary.find((s) => s.bucket === c.bucket)
    if (ch && c.mape > ch.mape + BACKTEST_TOLERANCE) return { ok: false, reason: `${c.bucket} で稼働中モデルより MAPE が高い（${c.mape.toFixed(3)} > ${ch.mape.toFixed(3)}）` }
  }
  return { ok: true, reason: '全区分で baseline と稼働中モデル以上の精度（同等許容 ±0.005）' }
}

export async function compareModelsService(hotelId: string, startDate?: Date, endDate?: Date, leadDays?: number[]): Promise<ModelComparison> {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { activeForecaster: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  const today = new Date()
  const end = endDate ?? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1))
  const start = startDate ?? new Date(end.getTime() - 29 * 86_400_000)

  const results: BacktestResult[] = []
  for (const name of AVAILABLE_MODELS) {
    results.push(await runBacktestService(hotelId, start, end, leadDays, resolveForecaster(name)))
  }
  const champion = results.find((r) => r.modelVersion === hotel.activeForecaster) ?? results[0]
  const promotable: ModelComparison['promotable'] = {}
  for (const r of results) {
    promotable[r.modelVersion] = r.modelVersion === hotel.activeForecaster ? { ok: false, reason: '稼働中' } : meetsGate(r, champion)
  }
  const states = await prisma.forecastModelState.findMany({ where: { hotelId }, select: { modelName: true, samples: true, trainedAt: true } })
  return {
    hotelId,
    activeForecaster: hotel.activeForecaster,
    results,
    promotable,
    states: states.map((s) => ({ ...s, trainedAt: s.trainedAt.toISOString() })),
  }
}

export async function promoteModelService(hotelId: string, modelName: string, force = false) {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { activeForecaster: true, tenantId: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  if (!(AVAILABLE_MODELS as readonly string[]).includes(modelName)) throw new BadRequestError(`未知のモデルです: ${modelName}`)
  let gate: { ok: boolean; reason: string } = { ok: true, reason: 'force' }
  if (!force && modelName !== hotel.activeForecaster) {
    const cmp = await compareModelsService(hotelId)
    gate = cmp.promotable[modelName] ?? { ok: false, reason: '比較結果がありません' }
    if (!gate.ok) throw new BadRequestError(`昇格条件を満たしていません: ${gate.reason}`)
  }
  const before = hotel.activeForecaster
  await prisma.hotel.update({ where: { id: hotelId }, data: { activeForecaster: modelName } })
  return { hotelId, tenantId: hotel.tenantId, before, after: modelName, gate }
}
