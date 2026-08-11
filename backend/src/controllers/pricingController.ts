import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import { getPricingCalendarService, getSimulationService } from '../services/pricingService.js'
import type { RateCategory } from '@prisma/client'
import { recomputeForecastService } from '../services/forecast/forecastService.js'

/**
 * 日別価格カレンダー
 * GET /api/v1/pricing/calendar?hotelId=&year=&month=
 */
export const getCalendar = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, year, month, roomTypeId, rateCategory } = req.query as unknown as {
    hotelId: string
    year: number
    month: number
    roomTypeId?: string
    rateCategory?: RateCategory
  }
  const result = await getPricingCalendarService(hotelId, year, month, { roomTypeId, rateCategory })
  sendSuccess(res, result)
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
