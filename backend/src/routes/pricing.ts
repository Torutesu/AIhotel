import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireRole, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import {
  monthQuerySchema,
  pricingCalendarQuerySchema,
  recomputeForecastSchema,
  forecastAccuracyQuerySchema,
  trainForecastModelSchema,
} from '../lib/validators.js'
import {
  getCalendar,
  getSimulation,
  recomputeForecast,
  getForecastAccuracy,
  trainForecastModel,
} from '../controllers/pricingController.js'

export const pricingRouter: ExpressRouter = Router()

// 全エンドポイント認証必須（C-2）
pricingRouter.use(authenticate)

// GET /api/v1/pricing/calendar?hotelId=&year=&month=&roomTypeId=&rateCategory=
pricingRouter.get(
  '/calendar',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(pricingCalendarQuerySchema, 'query'),
  getCalendar
)

// 価格戦略（重み付け設定）のエンドポイントは 2026/8 に撤去した。
// AI提案への介入は料金ランクの変更で行う（docs/drive-gap-analysis.md §3-3）。

// GET /api/v1/pricing/simulation?hotelId=&year=&month=
pricingRouter.get(
  '/simulation',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(monthQuerySchema, 'query'),
  getSimulation
)

// POST /api/v1/pricing/recompute — 需要予測の再計算は MANAGER 以上（F-DP-05, F-DP-03）
pricingRouter.post(
  '/recompute',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(recomputeForecastSchema),
  recomputeForecast
)

// GET /api/v1/pricing/accuracy — 予測精度（予測時点別）。閲覧はOPERATORも可
pricingRouter.get(
  '/accuracy',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(forecastAccuracyQuerySchema, 'query'),
  getForecastAccuracy
)

// POST /api/v1/pricing/train — 需要予測モデルの学習（MANAGER以上・監査対象）
pricingRouter.post(
  '/train',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(trainForecastModelSchema),
  trainForecastModel
)
