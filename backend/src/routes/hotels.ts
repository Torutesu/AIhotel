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

// GET /api/v1/hotels — ADMIN は全件、それ以外は自テナントのホテルのみ
hotelsRouter.get('/', getHotels)

// GET /api/v1/hotels/:id — 自ホテル or ADMIN のみ（C-3）
// :id は idParamSchema で必ず検証する（C-11）
hotelsRouter.get(
  '/:id',
  requireHotelAccess((req) => req.params.id),
  validate(idParamSchema, 'params'),
  getHotelById
)

// 作成・更新・削除は ADMIN 専用
hotelsRouter.post('/', requireRole('ADMIN'), validate(createHotelSchema), createHotel)
hotelsRouter.put(
  '/:id',
  requireRole('ADMIN'),
  validate(idParamSchema, 'params'),
  validate(updateHotelSchema),
  updateHotel
)
hotelsRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  validate(idParamSchema, 'params'),
  deleteHotel
)
