import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import {
  yearQuerySchema,
  hotelIdQuerySchema,
  competitorPricesQuerySchema,
} from '../lib/validators.js'
import {
  getMonthlyTrend,
  getCompetitorAnalysis,
  getReviewScores,
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
