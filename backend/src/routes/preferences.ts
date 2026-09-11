import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import { hotelIdQuerySchema, updatePreferencesSchema } from '../lib/validators.js'
import { getPreferences, updatePreferences } from '../controllers/preferencesController.js'

export const preferencesRouter: ExpressRouter = Router()

// 全エンドポイント認証必須
preferencesRouter.use(authenticate)

// GET /api/v1/preferences?hotelId=
preferencesRouter.get(
  '/',
  validate(hotelIdQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId),
  getPreferences
)

// PUT /api/v1/preferences
//
// 変更系だが requireRole は付けない。書き込み対象が常に「本人の表示設定」だけで、
// 他者・他テナントのデータには一切触れないため（OPERATOR も自分の画面設定は変更できる必要がある）。
// 対象ホテルの所属テナントは requireHotelAccess が検証する。
preferencesRouter.put(
  '/',
  validate(updatePreferencesSchema),
  requireHotelAccess((req) => req.body?.hotelId),
  updatePreferences
)
