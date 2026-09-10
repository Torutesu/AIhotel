import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireRole, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import {
  monthQuerySchema,
  hotelIdQuerySchema,
  updateStrategySchema,
  recomputeForecastSchema,
  signalsQuerySchema,
  ingestSignalsSchema,
  recordDecisionSchema,
  decisionsQuerySchema,
  learnSchema,
  backtestSchema,
  dailyJobSchema,
  evaluationQuerySchema,
  trainModelSchema,
  compareModelsSchema,
  promoteModelSchema,
} from '../lib/validators.js'
import {
  getCalendar,
  getStrategy,
  updateStrategy,
  getSimulation,
  recomputeForecast,
  getSignals,
  ingestSignals,
  getDigest,
  recordDecision,
  getDecisions,
  learn,
  getCoefficients,
  backtest,
  runDailyJob,
  getFactorEvaluation,
  getRecommendationEffect,
  compareModels,
  trainModel,
  promoteModel,
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

// POST /api/v1/pricing/recompute — 需要予測の再計算は MANAGER 以上（F-DP-05, F-DP-03）
pricingRouter.post(
  '/recompute',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(recomputeForecastSchema),
  recomputeForecast
)

// GET /api/v1/pricing/signals?hotelId=&startDate=&endDate= — 祝日・連休・天候シグナルの日別一覧
pricingRouter.get(
  '/signals',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(signalsQuerySchema, 'query'),
  getSignals
)

// POST /api/v1/pricing/signals/ingest — 天候シグナルの取り込みは MANAGER 以上
pricingRouter.post(
  '/signals/ingest',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(ingestSignalsSchema),
  ingestSignals
)

// GET /api/v1/pricing/digest?hotelId= — 今日決めるべき日・昨日からの変化・答え合わせ・採用率
pricingRouter.get(
  '/digest',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(hotelIdQuerySchema, 'query'),
  getDigest
)

// GET /api/v1/pricing/decisions?hotelId=&startDate=&endDate= — 採否記録一覧
pricingRouter.get(
  '/decisions',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(decisionsQuerySchema, 'query'),
  getDecisions
)

// POST /api/v1/pricing/decisions — 推奨の採否記録は MANAGER 以上
pricingRouter.post(
  '/decisions',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(recordDecisionSchema),
  recordDecision
)

// GET /api/v1/pricing/coefficients?hotelId= — 学習済み係数
pricingRouter.get(
  '/coefficients',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(hotelIdQuerySchema, 'query'),
  getCoefficients
)

// POST /api/v1/pricing/learn — 実績からの係数学習は MANAGER 以上
pricingRouter.post(
  '/learn',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(learnSchema),
  learn
)

// POST /api/v1/pricing/backtest — バックテストは MANAGER 以上
pricingRouter.post(
  '/backtest',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(backtestSchema),
  backtest
)

// POST /api/v1/pricing/jobs/daily — 日次ジョブの手動実行は ADMIN のみ
pricingRouter.post(
  '/jobs/daily',
  requireRole('ADMIN'),
  validate(dailyJobSchema),
  runDailyJob
)

// GET /api/v1/pricing/models?hotelId= — 稼働中モデルとチャレンジャーの比較（バックテスト）
pricingRouter.get(
  '/models',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(compareModelsSchema, 'query'),
  compareModels
)

// POST /api/v1/pricing/models/train — チャレンジャーの学習は MANAGER 以上
pricingRouter.post(
  '/models/train',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(trainModelSchema),
  trainModel
)

// POST /api/v1/pricing/models/promote — 稼働モデルの切替は ADMIN のみ
pricingRouter.post(
  '/models/promote',
  requireRole('ADMIN'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(promoteModelSchema),
  promoteModel
)

// GET /api/v1/pricing/evaluation/factors?hotelId= — 要因アブレーションと要因別成績表
pricingRouter.get(
  '/evaluation/factors',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(evaluationQuerySchema, 'query'),
  getFactorEvaluation
)

// GET /api/v1/pricing/evaluation/effect?hotelId= — 推奨の効果（需要レベル帯別）
pricingRouter.get(
  '/evaluation/effect',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(evaluationQuerySchema, 'query'),
  getRecommendationEffect
)
