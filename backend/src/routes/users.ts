import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireRole, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import { hotelIdQuerySchema, idParamSchema, updateUserSchema } from '../lib/validators.js'
import { getUsers, putUser } from '../controllers/usersController.js'

export const usersRouter: ExpressRouter = Router()

// ユーザー管理（N-3）。全エンドポイント認証必須＋ ADMIN または MANAGER のみ
// （運営 = PLATFORM_ADMIN は requireRole の上位集合として常に通る）。
// OPERATOR は他ユーザーの情報を参照・変更できない
usersRouter.use(authenticate)
usersRouter.use(requireRole('ADMIN', 'MANAGER'))

// GET /api/v1/users?hotelId= — そのホテルが属するテナントのユーザー一覧
usersRouter.get(
  '/',
  validate(hotelIdQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId),
  getUsers
)

// PUT /api/v1/users/:id — 名前・ロール・有効/無効の変更（監査対象）
// hotelId を受け取らないため requireHotelAccess は適用しない。
// テナント分離は usersService が actor.tenantId で絞り込むことで担保する
// （運営以外は ADMIN を含め他テナントのユーザーを 404 として扱う — #62）
usersRouter.put(
  '/:id',
  validate(idParamSchema, 'params'),
  validate(updateUserSchema),
  putUser
)
