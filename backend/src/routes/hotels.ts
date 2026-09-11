import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireRole, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import { createHotelSchema, updateHotelSchema, idParamSchema } from '../lib/validators.js'
import {
  getHotels,
  getHotelById,
  createHotel,
  updateHotel,
  deleteHotel,
} from '../controllers/hotelsController.js'

export const hotelsRouter: ExpressRouter = Router()

// 全エンドポイント認証必須（C-2）
hotelsRouter.use(authenticate)

// GET /api/v1/hotels — 運営（PLATFORM_ADMIN）は全件、それ以外は自テナントのホテルのみ（#62）
hotelsRouter.get('/', getHotels)

// GET /api/v1/hotels/:id — 自テナントのホテル or 運営のみ（C-3 / #62）
// :id は idParamSchema で必ず検証する（C-11）
hotelsRouter.get(
  '/:id',
  validate(idParamSchema, 'params'),
  requireHotelAccess((req) => req.params.id),
  getHotelById
)

// 作成・更新・削除は ADMIN（テナント管理者）以上。
// 更新・削除には requireHotelAccess を必ず通し、ADMIN が他テナントのホテルを
// 変更・削除できないようにする（#62）。作成時のテナントは
// hotelsController.createHotel が呼び出し元トークンから導出する
hotelsRouter.post('/', requireRole('ADMIN'), validate(createHotelSchema), createHotel)
hotelsRouter.put(
  '/:id',
  requireRole('ADMIN'),
  validate(idParamSchema, 'params'),
  validate(updateHotelSchema),
  requireHotelAccess((req) => req.params.id),
  updateHotel
)
hotelsRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  validate(idParamSchema, 'params'),
  requireHotelAccess((req) => req.params.id),
  deleteHotel
)
