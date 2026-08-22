import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess, sendCreated, sendDeleted } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import {
  getMonthlyTrendService,
  getCompetitorAnalysisService,
  getReviewScoresService,
  createReviewScoreService,
  deleteReviewScoreService,
  getOtaChannelSummaryService,
  getLandingForecastService,
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

/**
 * 口コミ評価点の手動登録（MANAGER 以上・監査対象 — レピュテーション管理）
 * POST /api/v1/analysis/reviews
 */
export const createReviewScore = asyncHandler(async (req: Request, res: Response) => {
  const record = await createReviewScoreService(req.body)
  await writeAuditLog({
    tenantId: record.tenantId,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'ReviewScore',
    entityId: record.id,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendCreated(res, record)
})

/**
 * 口コミ評価点の削除（MANAGER 以上・監査対象）
 * DELETE /api/v1/analysis/reviews/:id?hotelId=
 */
export const deleteReviewScore = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  await deleteReviewScoreService(req.params.id, hotelId)
  await writeAuditLog({
    userId: req.user!.userId,
    action: 'DELETE',
    entity: 'ReviewScore',
    entityId: req.params.id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendDeleted(res)
})

/**
 * OTAチャネル別実績集計
 * GET /api/v1/analysis/ota-channels?hotelId=&year=&month=
 */
export const getOtaChannelSummary = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, year, month } = req.query as unknown as {
    hotelId: string
    year: number
    month: number
  }
  const result = await getOtaChannelSummaryService(hotelId, year, month)
  sendSuccess(res, result)
})

/**
 * 当月着地予測（着地遷移 — F-DP-04）
 * GET /api/v1/analysis/landing?hotelId=&year=&month=
 */
export const getLandingForecast = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, year, month } = req.query as unknown as {
    hotelId: string
    year: number
    month: number
  }
  const result = await getLandingForecastService(hotelId, year, month)
  sendSuccess(res, result)
})
