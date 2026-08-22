import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireRole, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import {
  yearQuerySchema,
  hotelIdQuerySchema,
  competitorPricesQuerySchema,
  monthQuerySchema,
  createReviewScoreSchema,
} from '../lib/validators.js'
import {
  getMonthlyTrend,
  getCompetitorAnalysis,
  getReviewScores,
  createReviewScore,
  deleteReviewScore,
  getOtaChannelSummary,
  getLandingForecast,
} from '../controllers/analysisController.js'

export const analysisRouter: ExpressRouter = Router()

// 全エンドポイント認証必須 + hotelId のテナント分離（C-2/C-3）
// GET はクエリ、POST 系はボディから hotelId を取る
analysisRouter.use(authenticate)
analysisRouter.use(
  requireHotelAccess((req) => (req.query.hotelId as string | undefined) ?? req.body?.hotelId)
)

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

// POST /api/v1/analysis/reviews — 手動登録は MANAGER 以上（レピュテーション管理）
analysisRouter.post(
  '/reviews',
  requireRole('ADMIN', 'MANAGER'),
  validate(createReviewScoreSchema),
  createReviewScore
)

// DELETE /api/v1/analysis/reviews/:id?hotelId=
analysisRouter.delete(
  '/reviews/:id',
  requireRole('ADMIN', 'MANAGER'),
  validate(hotelIdQuerySchema, 'query'),
  deleteReviewScore
)

// GET /api/v1/analysis/ota-channels?hotelId=&year=&month= — OTAチャネル別実績集計
analysisRouter.get('/ota-channels', validate(monthQuerySchema, 'query'), getOtaChannelSummary)

// GET /api/v1/analysis/landing?hotelId=&year=&month= — 当月着地予測（着地遷移）
analysisRouter.get('/landing', validate(monthQuerySchema, 'query'), getLandingForecast)
