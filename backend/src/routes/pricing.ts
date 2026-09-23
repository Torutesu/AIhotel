import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireRole, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import {
  monthQuerySchema,
  hotelIdQuerySchema,
  updateStrategySchema,
  recomputeForecastSchema,
  monthTargetSchema,
  createPricingLockSchema,
  idParamSchema,
} from '../lib/validators.js'
import {
  getCalendar,
  getStrategy,
  updateStrategy,
  getSimulation,
  recomputeForecast,
  recomputeSimulation,
  getPricingLocks,
  createPricingLock,
  deletePricingLock,
} from '../controllers/pricingController.js'

export const pricingRouter: ExpressRouter = Router()

// 全エンドポイント認証必須（C-2）
pricingRouter.use(authenticate)

// GET /api/v1/pricing/calendar?hotelId=&year=&month=
pricingRouter.get(
  '/calendar',
  validate(monthQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId),
  getCalendar
)

// GET /api/v1/pricing/strategy?hotelId=
pricingRouter.get(
  '/strategy',
  validate(hotelIdQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId),
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
  requireHotelAccess((req) => req.query.hotelId),
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

// POST /api/v1/pricing/simulation/recompute — 着地シミュレーションの再計算は MANAGER 以上（N-5 / F-DP-04）
pricingRouter.post(
  '/simulation/recompute',
  requireRole('ADMIN', 'MANAGER'),
  validate(monthTargetSchema),
  requireHotelAccess((req) => req.body?.hotelId),
  recomputeSimulation
)

// 推奨を固定する期間（#17 のガードレール③）。閲覧は全ロール、登録・削除は MANAGER 以上
// GET /api/v1/pricing/locks?hotelId=
pricingRouter.get(
  '/locks',
  validate(hotelIdQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId),
  getPricingLocks
)

// POST /api/v1/pricing/locks
pricingRouter.post(
  '/locks',
  requireRole('ADMIN', 'MANAGER'),
  validate(createPricingLockSchema),
  requireHotelAccess((req) => req.body?.hotelId),
  createPricingLock
)

// DELETE /api/v1/pricing/locks/:id?hotelId=
pricingRouter.delete(
  '/locks/:id',
  requireRole('ADMIN', 'MANAGER'),
  validate(idParamSchema, 'params'),
  validate(hotelIdQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId),
  deletePricingLock
)
