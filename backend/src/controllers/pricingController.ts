import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import {
  getPricingCalendarService,
  getStrategyService,
  updateStrategyService,
  getSimulationService,
  recomputeSimulationService,
} from '../services/pricingService.js'
import { recomputeForecastService } from '../services/forecast/forecastService.js'
import type { MonthTargetInput } from '../lib/validators.js'

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
  const { hotelId, weightOccupancy, weightAdr, weightCompetitor } = req.body
  const { before, after } = await updateStrategyService(
    hotelId,
    { weightOccupancy, weightAdr, weightCompetitor },
    req.user!.userId
  )
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
 * 月間着地シミュレーションの再計算（MANAGER 以上・監査対象 — N-5 / F-DP-04）
 * POST /api/v1/pricing/simulation/recompute
 * body: { hotelId, year, month }
 *
 * 実績（DailyData）＋ AI 予測（AiPriceRecommendation）から着地見込みを組み直す。
 * 同一 (hotelId, year, month) に対して冪等。
 */
export const recomputeSimulation = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, year, month } = req.body as MonthTargetInput
  const result = await recomputeSimulationService(hotelId, year, month)

  await writeAuditLog({
    tenantId: result.simulation.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'MonthlyLandingSimulation',
    entityId: result.simulation.id,
    newValue: result.simulation,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })

  sendSuccess(
    res,
    result,
    200,
    `着地シミュレーションを再計算しました（実績${result.actualDays}日＋予測${result.predictedDays}日）`
  )
})
