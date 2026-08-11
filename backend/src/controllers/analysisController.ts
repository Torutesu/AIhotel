import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess } from '../utils/response.js'
import {
  getMonthlyTrendService,
  getCompetitorAnalysisService,
  getReviewScoresService,
} from '../services/analysisService.js'
import { getCancellationAnalysisService } from '../services/cancellationService.js'
import {
  getSegmentAnalysisService,
  getDailyRankingService,
} from '../services/segmentAnalysisService.js'
import type {
  CancellationQueryInput,
  SegmentAnalysisQueryInput,
  RankingQueryInput,
} from '../lib/validators.js'

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

/**
 * キャンセル分析（F-CXL-01）
 * GET /api/v1/analysis/cancellations?hotelId=&startDate=&endDate=&granularity=&compareLastYear=
 */
export const getCancellationAnalysis = asyncHandler(async (req: Request, res: Response) => {
  const result = await getCancellationAnalysisService(
    req.query as unknown as CancellationQueryInput
  )
  sendSuccess(res, result)
})

/**
 * セグメント別パフォーマンス（上位N — F-TOP-01）
 * GET /api/v1/analysis/segments?hotelId=&startDate=&endDate=&axis=&limit=&compareLastYear=
 */
export const getSegmentAnalysis = asyncHandler(async (req: Request, res: Response) => {
  const result = await getSegmentAnalysisService(
    req.query as unknown as SegmentAnalysisQueryInput
  )
  sendSuccess(res, result)
})

/**
 * 上位・下位分析（日別ADR / 日別稼働率 — F-TOP-01）
 * GET /api/v1/analysis/ranking?hotelId=&startDate=&endDate=&metric=&limit=
 */
export const getDailyRanking = asyncHandler(async (req: Request, res: Response) => {
  const result = await getDailyRankingService(req.query as unknown as RankingQueryInput)
  sendSuccess(res, result)
})
