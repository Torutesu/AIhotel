import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import { demandIndexQuerySchema, hotelIdQuerySchema } from '../lib/validators.js'
import { getDemandIndex, getExternalFactors, getExternalSignalsStatus } from '../controllers/externalSignalsController.js'

// 外部要因（D-13）。参照のみなのでロールは問わない（ホテルへのアクセス権だけ確かめる）
export const externalSignalsRouter: ExpressRouter = Router()

externalSignalsRouter.use(authenticate)

// GET /api/v1/external-signals/demand-index?hotelId=&months= — 月別需要指数（100 = 平均）
externalSignalsRouter.get(
  '/demand-index',
  validate(demandIndexQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId),
  getDemandIndex
)

// GET /api/v1/external-signals/status?hotelId= — 天気・祝日・エージェントの取得状況
externalSignalsRouter.get(
  '/status',
  validate(hotelIdQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId),
  getExternalSignalsStatus
)

// GET /api/v1/external-signals/factors?hotelId= — 要因カード（気候・インバウンド・アクセス）と週別の見通し
externalSignalsRouter.get(
  '/factors',
  validate(hotelIdQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId),
  getExternalFactors
)
