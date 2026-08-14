import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess } from '../utils/response.js'
import {
  getDashboardKpiService,
  getKpiComparisonService,
  getAlertsService,
  getAiSummaryService,
} from '../services/dashboardService.js'

/**
 * 月別KPI取得
 * GET /api/v1/dashboard/kpi?hotelId=&year=&month=
 */
export const getKpi = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, year, month } = req.query as unknown as {
    hotelId: string
    year: number
    month: number
  }
  const result = await getDashboardKpiService(hotelId, year, month)
  sendSuccess(res, result)
})

/**
 * KPI比較（月初/日付比較）
 * GET /api/v1/dashboard/kpi/comparison?hotelId=&year=&month=&baseDate=
 */
export const getKpiComparison = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, year, month, baseDate } = req.query as unknown as {
    hotelId: string
    year: number
    month: number
    baseDate?: Date
  }
  const result = await getKpiComparisonService(hotelId, year, month, baseDate)
  sendSuccess(res, result)
})

/**
 * アラート一覧
 * GET /api/v1/dashboard/alerts?hotelId=
 */
export const getAlerts = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, minLevel } = req.query as unknown as { hotelId: string; minLevel?: number }
  const result = await getAlertsService(hotelId, minLevel)
  sendSuccess(res, result)
})

/**
 * AIまとめ
 * GET /api/v1/dashboard/ai-summary?hotelId=&section=
 */
export const getAiSummary = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, section } = req.query as unknown as { hotelId: string; section?: string }
  const result = await getAiSummaryService(hotelId, section)
  sendSuccess(res, result)
})
