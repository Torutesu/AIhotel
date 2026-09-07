import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import {
  getPricingCalendarService,
  getStrategyService,
  updateStrategyService,
  getSimulationService,
} from '../services/pricingService.js'
import { recomputeForecastService } from '../services/forecast/forecastService.js'
import type { UpdateStrategyInput, RecordDecisionInput } from '../lib/validators.js'
import { getSignalsService, ingestWeatherSignalsService } from '../services/signals/signalService.js'
import { recordDecisionService, listDecisionsService } from '../services/pricing/decisionService.js'
import { getPricingDigestService } from '../services/pricing/digestService.js'
import { learnFromActualsService, getCoefficientsService } from '../services/forecast/learningService.js'
import { runBacktestService } from '../services/forecast/backtestService.js'
import { runDailyJobService } from '../services/jobs/dailyJob.js'

/**
 * 日別価格カレンダー
 * GET /api/v1/pricing/calendar?hotelId=&year=&month=
 */
export const getCalendar = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, year, month } = req.query as unknown as {
    hotelId: string
    year: number
    month: number
  }
  const result = await getPricingCalendarService(hotelId, year, month)
  sendSuccess(res, result)
})

/**
 * 価格戦略の重み付け取得
 * GET /api/v1/pricing/strategy?hotelId=
 */
export const getStrategy = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  const result = await getStrategyService(hotelId)
  sendSuccess(res, result)
})

/**
 * 価格戦略の重み付け更新（MANAGER 以上・監査対象 — F-DP-02）
 * PUT /api/v1/pricing/strategy
 */
export const updateStrategy = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, ...weights } = req.body as UpdateStrategyInput
  const { before, after } = await updateStrategyService(hotelId, weights, req.user!.userId)
  await writeAuditLog({
    tenantId: after.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'PricingStrategyConfig',
    entityId: after.id,
    oldValue: before,
    newValue: after,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, after, 200, '価格戦略を更新しました')
})

/**
 * 月間着地シミュレーション
 * GET /api/v1/pricing/simulation?hotelId=&year=&month=
 */
export const getSimulation = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, year, month } = req.query as unknown as {
    hotelId: string
    year: number
    month: number
  }
  const result = await getSimulationService(hotelId, year, month)
  sendSuccess(res, result)
})

/**
 * 需要予測の再計算（ADMIN/MANAGER・監査対象 — F-DP-05）
 * ルールベース予測で AiPriceRecommendation を再生成する。
 * F-DP-03（AI予測値へのリセット）のバックエンドとしても機能する。
 * POST /api/v1/pricing/recompute
 */
export const recomputeForecast = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, startDate, endDate } = req.body as {
    hotelId: string
    startDate?: Date
    endDate?: Date
  }
  const result = await recomputeForecastService(hotelId, startDate, endDate)
  await writeAuditLog({
    tenantId: result.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'AiPriceRecommendation',
    entityId: hotelId,
    newValue: result,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, result, 200, `需要予測を再計算しました（${result.count}件）`)
})

/**
 * 外部シグナル（祝日・連休・天候）の日別一覧
 * GET /api/v1/pricing/signals?hotelId=&startDate=&endDate=
 */
export const getSignals = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, startDate, endDate } = req.query as unknown as {
    hotelId: string
    startDate: Date
    endDate: Date
  }
  const result = await getSignalsService(hotelId, startDate, endDate)
  sendSuccess(res, result)
})

/**
 * 天候シグナルの取り込み（気象庁 / Open-Meteo）。MANAGER 以上・監査対象
 * POST /api/v1/pricing/signals/ingest
 */
export const ingestSignals = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.body as { hotelId: string }
  const result = await ingestWeatherSignalsService(hotelId)
  await writeAuditLog({
    tenantId: result.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'ExternalSignal',
    entityId: hotelId,
    newValue: result,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  const total = (result.jma?.count ?? 0) + (result.openMeteo?.count ?? 0)
  sendSuccess(res, result, 200, `天候シグナルを取り込みました（${total}件）`)
})

/**
 * 今日決めるべき日・昨日からの変化・答え合わせ・採用率
 * GET /api/v1/pricing/digest?hotelId=
 */
export const getDigest = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  sendSuccess(res, await getPricingDigestService(hotelId))
})

/**
 * 推奨の採否記録（MANAGER 以上・監査対象）
 * POST /api/v1/pricing/decisions
 */
export const recordDecision = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as RecordDecisionInput
  const decision = await recordDecisionService(input, req.user!.userId)
  await writeAuditLog({
    tenantId: decision.tenantId,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'RecommendationDecision',
    entityId: decision.id,
    newValue: decision,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, decision, 201, `R${decision.appliedRank} を適用として記録しました`)
})

/**
 * 採否記録一覧
 * GET /api/v1/pricing/decisions?hotelId=&startDate=&endDate=
 */
export const getDecisions = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, startDate, endDate } = req.query as unknown as { hotelId: string; startDate: Date; endDate: Date }
  sendSuccess(res, await listDecisionsService(hotelId, startDate, endDate))
})

/**
 * 実績からの係数学習（MANAGER 以上・監査対象）
 * POST /api/v1/pricing/learn
 */
export const learn = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.body as { hotelId: string }
  const result = await learnFromActualsService(hotelId)
  await writeAuditLog({
    tenantId: result.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'FactorCoefficient',
    entityId: hotelId,
    newValue: result,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, result, 200, `${result.samples}件の実績で係数を更新しました`)
})

/**
 * 学習済み係数一覧
 * GET /api/v1/pricing/coefficients?hotelId=
 */
export const getCoefficients = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  sendSuccess(res, await getCoefficientsService(hotelId))
})

/**
 * バックテスト（MANAGER 以上）
 * POST /api/v1/pricing/backtest
 */
export const backtest = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, startDate, endDate, leadDays } = req.body as { hotelId: string; startDate: Date; endDate: Date; leadDays?: number[] }
  sendSuccess(res, await runBacktestService(hotelId, startDate, endDate, leadDays))
})

/**
 * 日次ジョブの手動実行（ADMIN・監査対象）
 * POST /api/v1/pricing/jobs/daily
 */
export const runDailyJob = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.body as { hotelId?: string }
  const result = await runDailyJobService(hotelId)
  await writeAuditLog({
    tenantId: req.user!.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'DailyJob',
    entityId: hotelId ?? null,
    newValue: result,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, result, 200, `日次ジョブを実行しました（${result.hotels.length}ホテル）`)
})
