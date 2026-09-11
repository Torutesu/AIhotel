import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireRole, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import {
  monthQuerySchema,
  hotelIdQuerySchema,
  updateStrategySchema,
  recomputeForecastSchema,
} from '../lib/validators.js'
import {
  getCalendar,
  getStrategy,
  updateStrategy,
  getSimulation,
  recomputeForecast,
} from '../controllers/pricingController.js'

export const pricingRouter: ExpressRouter = Router()

// 全エンドポイント認証必須（C-2）
pricingRouter.use(authenticate)

// GET /api/v1/pricing/calendar?hotelId=&year=&month=
// hotelId は requireHotelAccess の判定材料になるため、検証を先に通す
pricingRouter.get(
  '/calendar',
  validate(monthQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  getCalendar
)

// GET /api/v1/pricing/strategy?hotelId=
pricingRouter.get(
  '/strategy',
  validate(hotelIdQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  getStrategy
)

// PUT /api/v1/pricing/strategy — 重み付け変更は MANAGER 以上（F-DP-02）
pricingRouter.put(
  '/strategy',
  requireRole('ADMIN', 'MANAGER'),
  validate(updateStrategySchema),
  requireHotelAccess((req) => req.body?.hotelId),
  updateStrategy
)

// GET /api/v1/pricing/simulation?hotelId=&year=&month=
pricingRouter.get(
  '/simulation',
  validate(monthQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  getSimulation
)

// POST /api/v1/pricing/recompute — 需要予測の再計算は MANAGER 以上（F-DP-05, F-DP-03）
pricingRouter.post(
  '/recompute',
  requireRole('ADMIN', 'MANAGER'),
  validate(recomputeForecastSchema),
  requireHotelAccess((req) => req.body?.hotelId),
  recomputeForecast
)
