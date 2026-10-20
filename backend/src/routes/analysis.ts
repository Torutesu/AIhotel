import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import {
  yearQuerySchema,
  hotelIdQuerySchema,
  competitorPricesQuerySchema,
  monthQuerySchema,
} from '../lib/validators.js'
import {
  getMonthlyTrend,
  getCompetitorAnalysis,
  getReviewScores,
  getChannelBreakdown,
  getRoomTypeBreakdown,
  getDayOfWeekBreakdown,
  getDailyPerformance,
  getMonthPace,
  getDayTypeBreakdown,
} from '../controllers/analysisController.js'

export const analysisRouter: ExpressRouter = Router()

// 全エンドポイント認証必須 + hotelId のテナント分離（C-2/C-3）
analysisRouter.use(authenticate)
analysisRouter.use(
  // 各ルートの validate() より前に走るため、hotelId の型検証は
  // requireHotelAccess 側の typeof チェックに任せる（文字列以外は 400）
  requireHotelAccess((req) => req.query.hotelId)
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

// 対象月の実績の内訳（#88）
// GET /api/v1/analysis/channels?hotelId=&year=&month=
analysisRouter.get('/channels', validate(monthQuerySchema, 'query'), getChannelBreakdown)
// GET /api/v1/analysis/room-types?hotelId=&year=&month=
analysisRouter.get('/room-types', validate(monthQuerySchema, 'query'), getRoomTypeBreakdown)
// GET /api/v1/analysis/day-of-week?hotelId=&year=&month=
analysisRouter.get('/day-of-week', validate(monthQuerySchema, 'query'), getDayOfWeekBreakdown)
// GET /api/v1/analysis/daily-performance?hotelId=&year=&month= — 実績と日割り予算・AI の予測・前年同曜日（2026-10）
analysisRouter.get('/daily-performance', validate(monthQuerySchema, 'query'), getDailyPerformance)
// GET /api/v1/analysis/month-pace?hotelId=&year=&month= — 月の予約の積み上がり（180日前 → 結果）と予算・AI・前年の比較
analysisRouter.get('/month-pace', validate(monthQuerySchema, 'query'), getMonthPace)
// GET /api/v1/analysis/day-type?hotelId=&year=&month= — 日のタイプ別パフォーマンス（当月以降は実績＋予約 — 2026-10）
analysisRouter.get('/day-type', validate(monthQuerySchema, 'query'), getDayTypeBreakdown)
