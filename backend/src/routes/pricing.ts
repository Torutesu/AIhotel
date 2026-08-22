import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireRole, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import {
  monthQuerySchema,
  hotelIdQuerySchema,
  updateStrategySchema,
  recomputeForecastSchema,
  longRangeQuerySchema,
} from '../lib/validators.js'
import {
  getCalendar,
  getStrategy,
  updateStrategy,
  getSimulation,
  recomputeForecast,
  getLongRangeOutlook,
} from '../controllers/pricingController.js'

export const pricingRouter: ExpressRouter = Router()

// 全エンドポイント認証必須（C-2）
pricingRouter.use(authenticate)

// GET /api/v1/pricing/calendar?hotelId=&year=&month=
pricingRouter.get(
  '/calendar',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(monthQuerySchema, 'query'),
  getCalendar
)

// GET /api/v1/pricing/strategy?hotelId=
pricingRouter.get(
  '/strategy',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(hotelIdQuerySchema, 'query'),
  getStrategy
)

// PUT /api/v1/pricing/strategy — 重み付け変更は MANAGER 以上（F-DP-02）
pricingRouter.put(
  '/strategy',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(updateStrategySchema),
  updateStrategy
)

// GET /api/v1/pricing/simulation?hotelId=&year=&month=
pricingRouter.get(
  '/simulation',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(monthQuerySchema, 'query'),
  getSimulation
)

// GET /api/v1/pricing/long-range?hotelId=&days= — 1年先アウトルック（月別集計）
pricingRouter.get(
  '/long-range',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(longRangeQuerySchema, 'query'),
  getLongRangeOutlook
)

// POST /api/v1/pricing/recompute — 需要予測の再計算は MANAGER 以上（F-DP-05, F-DP-03）
pricingRouter.post(
  '/recompute',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(recomputeForecastSchema),
  recomputeForecast
)
