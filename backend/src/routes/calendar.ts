import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireRole, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import {
  specialDaysQuerySchema,
  createSpecialDaySchema,
  updateSpecialDaySchema,
  hotelIdQuerySchema,
  externalFactorsQuerySchema,
  createExternalFactorSchema,
  updateExternalFactorSchema,
} from '../lib/validators.js'
import {
  getSpecialDays,
  createSpecialDay,
  updateSpecialDay,
  deleteSpecialDay,
  getExternalFactors,
  createExternalFactor,
  updateExternalFactor,
  deleteExternalFactor,
} from '../controllers/calendarController.js'

// 特日マスタ・外部要因（Phase 4C — F-DP-08, F-EXT-01）
export const calendarRouter: ExpressRouter = Router()

// 全エンドポイント認証必須
calendarRouter.use(authenticate)

// ---- 特日マスタ（AI提示 → オペレーターが修正）----

// GET /api/v1/calendar/special-days?hotelId=&startDate=&endDate=
calendarRouter.get(
  '/special-days',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(specialDaysQuerySchema, 'query'),
  getSpecialDays
)

// 特日の追加・修正・削除は MANAGER 以上（マスタ設定のため）
calendarRouter.post(
  '/special-days',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(createSpecialDaySchema),
  createSpecialDay
)

calendarRouter.put(
  '/special-days/:id',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(hotelIdQuerySchema, 'query'),
  validate(updateSpecialDaySchema),
  updateSpecialDay
)

calendarRouter.delete(
  '/special-days/:id',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(hotelIdQuerySchema, 'query'),
  deleteSpecialDay
)

// ---- 外部要因 ----

// GET /api/v1/calendar/external-factors?hotelId=&startDate=&endDate=&category=
calendarRouter.get(
  '/external-factors',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(externalFactorsQuerySchema, 'query'),
  getExternalFactors
)

// 外部要因の登録・更新は OPERATOR も可（イベント情報登録と同じ扱い — F-DP-07）
calendarRouter.post(
  '/external-factors',
  requireHotelAccess((req) => req.body?.hotelId),
  validate(createExternalFactorSchema),
  createExternalFactor
)

calendarRouter.put(
  '/external-factors/:id',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(hotelIdQuerySchema, 'query'),
  validate(updateExternalFactorSchema),
  updateExternalFactor
)

// 削除は MANAGER 以上
calendarRouter.delete(
  '/external-factors/:id',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(hotelIdQuerySchema, 'query'),
  deleteExternalFactor
)
