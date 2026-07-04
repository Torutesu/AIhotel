import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess } from '../utils/response.js'
import {
  getMonthlyTrendService,
  getCompetitorAnalysisService,
  getReviewScoresService,
} from '../services/analysisService.js'

/**
 * 年間推移（月単位 — F-ANA-03）
 * GET /api/v1/analysis/monthly?hotelId=&year=
 */
export const getMonthlyTrend = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, year } = req.query as unknown as { hotelId: string; year: number }
  const result = await getMonthlyTrendService(hotelId, year)
  sendSuccess(res, result)
})

/**
 * 競合分析（ホテル別販売価格 — F-ANA-02）
 * GET /api/v1/analysis/competitor?hotelId=&startDate=&endDate=
 */
export const getCompetitorAnalysis = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, startDate, endDate } = req.query as unknown as {
    hotelId: string
    startDate: Date
    endDate: Date
  }
  const result = await getCompetitorAnalysisService(hotelId, startDate, endDate)
  sendSuccess(res, result)
})

/**
 * 口コミ評価点（F-ANA-04）
 * GET /api/v1/analysis/reviews?hotelId=
 */
export const getReviewScores = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  const result = await getReviewScoresService(hotelId)
  sendSuccess(res, result)
})
