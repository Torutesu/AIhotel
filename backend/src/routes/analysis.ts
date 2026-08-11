import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import {
  yearQuerySchema,
  hotelIdQuerySchema,
  competitorPricesQuerySchema,
  cancellationQuerySchema,
  segmentAnalysisQuerySchema,
  rankingQuerySchema,
} from '../lib/validators.js'
import {
  getMonthlyTrend,
  getCompetitorAnalysis,
  getReviewScores,
  getCancellationAnalysis,
  getSegmentAnalysis,
  getDailyRanking,
} from '../controllers/analysisController.js'

export const analysisRouter: ExpressRouter = Router()

// 全エンドポイント認証必須 + hotelId のテナント分離（C-2/C-3）
analysisRouter.use(authenticate)
analysisRouter.use(requireHotelAccess((req) => req.query.hotelId as string | undefined))

// GET /api/v1/analysis/monthly?hotelId=&year=
analysisRouter.get('/monthly', validate(yearQuerySchema, 'query'), getMonthlyTrend)

// GET /api/v1/analysis/competitor?hotelId=&startDate=&endDate=
analysisRouter.get(
  '/competitor',
  validate(competitorPricesQuerySchema, 'query'),
  getCompetitorAnalysis
)

// GET /api/v1/analysis/reviews?hotelId=
analysisRouter.get('/reviews', validate(hotelIdQuerySchema, 'query'), getReviewScores)

// GET /api/v1/analysis/cancellations?hotelId=&startDate=&endDate=&granularity=（F-CXL-01）
analysisRouter.get(
  '/cancellations',
  validate(cancellationQuerySchema, 'query'),
  getCancellationAnalysis
)

// GET /api/v1/analysis/segments?hotelId=&startDate=&endDate=&axis=&limit=（F-TOP-01）
analysisRouter.get('/segments', validate(segmentAnalysisQuerySchema, 'query'), getSegmentAnalysis)

// GET /api/v1/analysis/ranking?hotelId=&startDate=&endDate=&metric=&limit=（F-TOP-01）
analysisRouter.get('/ranking', validate(rankingQuerySchema, 'query'), getDailyRanking)
