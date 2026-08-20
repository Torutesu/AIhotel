import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import {
  saveOperatorForecastsService,
  listOperatorForecastsService,
  getVarianceSettingService,
  updateVarianceSettingService,
} from '../services/forecastVariance/operatorForecastService.js'
import { getForecastVarianceService } from '../services/forecastVariance/forecastVarianceService.js'
import type {
  SaveOperatorForecastsInput,
  OperatorForecastsQueryInput,
  UpdateVarianceSettingInput,
} from '../lib/validators.js'

/**
 * レベニュー担当の日別予測を登録する（MANAGER以上・監査対象 — F-DP-11）
 * POST /api/v1/pricing/forecasts
 */
export const saveOperatorForecasts = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, entries } = req.body as SaveOperatorForecastsInput
  const result = await saveOperatorForecastsService(hotelId, entries, req.user!.userId)

  await writeAuditLog({
    tenantId: result.tenantId,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'OperatorForecast',
    entityId: hotelId,
    newValue: result,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })

  sendSuccess(
    res,
    result,
    201,
    `担当者予測を${result.saved}件登録しました（AI予測との乖離が基準超え: ${result.exceededCount}件）`
  )
})

/**
 * 担当者予測の履歴（全バージョン — F-DP-11）
 * GET /api/v1/pricing/forecasts?hotelId=&startDate=&endDate=
 */
export const getOperatorForecasts = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, startDate, endDate } = req.query as unknown as OperatorForecastsQueryInput
  const forecasts = await listOperatorForecastsService(hotelId, startDate, endDate)
  sendSuccess(res, forecasts)
})

/**
 * AI予測と担当者予測の差異レポート（F-DP-11 / F-DP-12）
 * GET /api/v1/pricing/forecast-variance?hotelId=&year=&month=
 */
export const getForecastVariance = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, year, month } = req.query as unknown as {
    hotelId: string
    year: number
    month: number
  }
  const result = await getForecastVarianceService(hotelId, year, month)
  sendSuccess(res, result)
})

/**
 * 意図・背景を必須にする乖離幅の設定を取得する（F-DP-12）
 * GET /api/v1/pricing/forecast-variance/settings?hotelId=
 */
export const getVarianceSetting = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  const setting = await getVarianceSettingService(hotelId)
  sendSuccess(res, setting)
})

/**
 * 乖離幅の設定を更新する（MANAGER以上・監査対象 — F-DP-12）
 * PUT /api/v1/pricing/forecast-variance/settings
 */
export const updateVarianceSetting = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, occupancyPtThreshold, adrPctThreshold, revenuePctThreshold } =
    req.body as UpdateVarianceSettingInput

  const { before, after } = await updateVarianceSettingService(
    hotelId,
    { occupancyPtThreshold, adrPctThreshold, revenuePctThreshold },
    req.user!.userId
  )

  await writeAuditLog({
    tenantId: after.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'ForecastVarianceSetting',
    entityId: after.id,
    oldValue: before,
    newValue: after,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })

  sendSuccess(res, after, 200, '意図・背景を必須にする乖離幅を更新しました')
})
