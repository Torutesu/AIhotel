import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireRole, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import {
  groupBookingsQuerySchema,
  createGroupBookingSchema,
  updateGroupBookingSchema,
} from '../lib/validators.js'
import {
  getPresets,
  listGroupBookings,
  createGroupBooking,
  updateGroupBooking,
  deleteGroupBooking,
} from '../controllers/groupBookingsController.js'

export const groupBookingsRouter: ExpressRouter = Router()

// 全エンドポイント認証必須（C-2）
groupBookingsRouter.use(authenticate)

// 影響ルールの選択肢はシステム固定のためホテル指定不要
groupBookingsRouter.get('/presets', getPresets)

groupBookingsRouter.get(
  '/',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(groupBookingsQuerySchema, 'query'),
  listGroupBookings
)

// 変更系は MANAGER 以上（要件定義書 §4）
groupBookingsRouter.post(
  '/',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(createGroupBookingSchema),
  createGroupBooking
)

groupBookingsRouter.put(
  '/:id',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(updateGroupBookingSchema),
  updateGroupBooking
)

groupBookingsRouter.delete(
  '/:id',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  deleteGroupBooking
)
