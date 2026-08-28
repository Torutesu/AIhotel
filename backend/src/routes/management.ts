import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireRole, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import {
  hotelIdQuerySchema,
  updateUserRoleSchema,
  setUserActiveSchema,
  createRoomTypeSchema,
  updateRoomTypeSchema,
  createCompetitorSchema,
  updateCompetitorSchema,
} from '../lib/validators.js'
import {
  listUsers,
  updateUserRole,
  setUserActive,
  listRoomTypes,
  createRoomType,
  updateRoomType,
  deactivateRoomType,
  listCompetitors,
  createCompetitor,
  updateCompetitor,
  deactivateCompetitor,
} from '../controllers/managementController.js'

export const managementRouter: ExpressRouter = Router()

// 全エンドポイント認証必須（C-2）
managementRouter.use(authenticate)

// hotelId は全操作で必要。クエリまたはボディのどちらかで受ける
const hotelFromQuery = requireHotelAccess((req) => req.query.hotelId as string | undefined)
const hotelFromBody = requireHotelAccess((req) => req.body?.hotelId)
// 変更系は MANAGER 以上（要件定義書 §4）
const canManage = requireRole('ADMIN', 'MANAGER')

// ---- ユーザー管理 ----
// 新規追加は招待メール（POST /auth/invitations）で行うため、ここには作成系がない
managementRouter.get('/users', hotelFromQuery, validate(hotelIdQuerySchema, 'query'), listUsers)
managementRouter.put(
  '/users/:id/role',
  canManage,
  hotelFromQuery,
  validate(updateUserRoleSchema),
  updateUserRole
)
managementRouter.put(
  '/users/:id/active',
  canManage,
  hotelFromQuery,
  validate(setUserActiveSchema),
  setUserActive
)

// ---- 客室タイプ ----
managementRouter.get('/room-types', hotelFromQuery, listRoomTypes)
managementRouter.post(
  '/room-types',
  canManage,
  hotelFromBody,
  validate(createRoomTypeSchema),
  createRoomType
)
managementRouter.put(
  '/room-types/:id',
  canManage,
  hotelFromQuery,
  validate(updateRoomTypeSchema),
  updateRoomType
)
managementRouter.delete('/room-types/:id', canManage, hotelFromQuery, deactivateRoomType)

// ---- 競合ホテル（F-SET-03） ----
managementRouter.get('/competitors', hotelFromQuery, listCompetitors)
managementRouter.post(
  '/competitors',
  canManage,
  hotelFromBody,
  validate(createCompetitorSchema),
  createCompetitor
)
managementRouter.put(
  '/competitors/:id',
  canManage,
  hotelFromQuery,
  validate(updateCompetitorSchema),
  updateCompetitor
)
managementRouter.delete('/competitors/:id', canManage, hotelFromQuery, deactivateCompetitor)
