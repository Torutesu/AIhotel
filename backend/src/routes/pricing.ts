import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireRole, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import {
  monthQuerySchema,
  hotelIdQuerySchema,
  updateStrategySchema,
  recomputeForecastSchema,
  createPriceDecisionSchema,
  priceDecisionsQuerySchema,
  recomputePreferenceProfilesSchema,
  updatePreferenceProfileSchema,
  idParamSchema,
} from '../lib/validators.js'
import {
  getCalendar,
  getStrategy,
  updateStrategy,
  getSimulation,
  recomputeForecast,
} from '../controllers/pricingController.js'
import {
  createPriceDecision,
  getPriceDecisions,
  getIntentVariance,
  getPreferenceProfiles,
  recomputePreferenceProfiles,
  updatePreferenceProfile,
} from '../controllers/operatorIntentController.js'

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

// POST /api/v1/pricing/recompute — 需要予測の再計算は MANAGER 以上（F-DP-05, F-DP-03）
pricingRouter.post(
  '/recompute',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(recomputeForecastSchema),
  recomputeForecast
)

// ======================================
// 運営担当者の意向・差異・継続学習（F-DP-08 / F-DP-09 / F-DP-10）
// ======================================

// POST /api/v1/pricing/decisions — 価格判断を実際に行う現場の運営担当者(OPERATOR)が
// 記録する前提のため requireRole は付けない（イベント登録 F-DP-07 と同じ扱い）。
// 記録は監査ログに残し、判断種別はサーバ側でAI推奨との差から導出する。
pricingRouter.post(
  '/decisions',
  requireHotelAccess((req) => req.body?.hotelId),
  validate(createPriceDecisionSchema),
  createPriceDecision
)

// GET /api/v1/pricing/decisions?hotelId=&startDate=&endDate=
pricingRouter.get(
  '/decisions',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(priceDecisionsQuerySchema, 'query'),
  getPriceDecisions
)

// GET /api/v1/pricing/variance?hotelId=&year=&month= — AI推奨と実際にやった値の差異
pricingRouter.get(
  '/variance',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(monthQuerySchema, 'query'),
  getIntentVariance
)

// GET /api/v1/pricing/learning/profiles?hotelId= — 学習済みの意向プロファイル
pricingRouter.get(
  '/learning/profiles',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(hotelIdQuerySchema, 'query'),
  getPreferenceProfiles
)

// POST /api/v1/pricing/learning/recompute — 再学習は MANAGER 以上（F-DP-10）
pricingRouter.post(
  '/learning/recompute',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(recomputePreferenceProfilesSchema),
  recomputePreferenceProfiles
)

// PATCH /api/v1/pricing/learning/profiles/:id — 予測への反映可否の承認は MANAGER 以上
pricingRouter.patch(
  '/learning/profiles/:id',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(idParamSchema, 'params'),
  validate(updatePreferenceProfileSchema),
  updatePreferenceProfile
)
