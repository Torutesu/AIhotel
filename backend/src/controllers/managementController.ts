import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess, sendCreated, sendDeleted } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import {
  listUsersService,
  updateUserRoleService,
  setUserActiveService,
} from '../services/usersService.js'
import {
  listRoomTypesService,
  createRoomTypeService,
  updateRoomTypeService,
  deactivateRoomTypeService,
} from '../services/roomTypesService.js'
import {
  listCompetitorsService,
  createCompetitorService,
  updateCompetitorService,
  deactivateCompetitorService,
} from '../services/competitorsService.js'

// ホテル単位の管理操作（ユーザー・客室タイプ・競合ホテル）。
// いずれも設定タブから使う。変更系はすべて監査ログに記録する。

function hotelIdFromQuery(req: Request): string {
  return req.query.hotelId as string
}

function auditContext(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] }
}

// ---- ユーザー ----

/** GET /api/v1/management/users?hotelId= */
export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await listUsersService(hotelIdFromQuery(req)))
})

/** PUT /api/v1/management/users/:id/role?hotelId= */
export const updateUserRole = asyncHandler(async (req: Request, res: Response) => {
  const user = await updateUserRoleService(
    req.params.id,
    hotelIdFromQuery(req),
    req.body.role,
    { userId: req.user!.userId }
  )
  await writeAuditLog({
    tenantId: user.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'User',
    entityId: user.id,
    newValue: { role: req.body.role },
    ...auditContext(req),
  })
  sendSuccess(res, user, 200, '権限を変更しました')
})

/** PUT /api/v1/management/users/:id/active?hotelId= */
export const setUserActive = asyncHandler(async (req: Request, res: Response) => {
  const user = await setUserActiveService(
    req.params.id,
    hotelIdFromQuery(req),
    req.body.isActive,
    { userId: req.user!.userId }
  )
  await writeAuditLog({
    tenantId: user.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'User',
    entityId: user.id,
    newValue: { isActive: req.body.isActive },
    ...auditContext(req),
  })
  sendSuccess(res, user, 200, req.body.isActive ? '有効化しました' : '無効化しました')
})

// ---- 客室タイプ ----

/** GET /api/v1/management/room-types?hotelId= */
export const listRoomTypes = asyncHandler(async (req: Request, res: Response) => {
  const includeInactive = req.query.includeInactive === 'true'
  sendSuccess(res, await listRoomTypesService(hotelIdFromQuery(req), includeInactive))
})

/** POST /api/v1/management/room-types */
export const createRoomType = asyncHandler(async (req: Request, res: Response) => {
  const roomType = await createRoomTypeService(req.body)
  await writeAuditLog({
    tenantId: roomType.tenantId,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'RoomType',
    entityId: roomType.id,
    newValue: req.body,
    ...auditContext(req),
  })
  sendCreated(res, roomType)
})

/** PUT /api/v1/management/room-types/:id?hotelId= */
export const updateRoomType = asyncHandler(async (req: Request, res: Response) => {
  const roomType = await updateRoomTypeService(req.params.id, hotelIdFromQuery(req), req.body)
  await writeAuditLog({
    tenantId: roomType?.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'RoomType',
    entityId: req.params.id,
    newValue: req.body,
    ...auditContext(req),
  })
  sendSuccess(res, roomType, 200, '客室タイプを更新しました')
})

/** DELETE /api/v1/management/room-types/:id?hotelId=（論理削除） */
export const deactivateRoomType = asyncHandler(async (req: Request, res: Response) => {
  await deactivateRoomTypeService(req.params.id, hotelIdFromQuery(req))
  await writeAuditLog({
    tenantId: req.user!.tenantId,
    userId: req.user!.userId,
    action: 'DELETE',
    entity: 'RoomType',
    entityId: req.params.id,
    ...auditContext(req),
  })
  sendDeleted(res, '客室タイプを無効化しました')
})

// ---- 競合ホテル（F-SET-03） ----

/** GET /api/v1/management/competitors?hotelId= */
export const listCompetitors = asyncHandler(async (req: Request, res: Response) => {
  const includeInactive = req.query.includeInactive === 'true'
  sendSuccess(res, await listCompetitorsService(hotelIdFromQuery(req), includeInactive))
})

/** POST /api/v1/management/competitors */
export const createCompetitor = asyncHandler(async (req: Request, res: Response) => {
  const competitor = await createCompetitorService(req.body)
  await writeAuditLog({
    tenantId: competitor.tenantId,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'Competitor',
    entityId: competitor.id,
    newValue: req.body,
    ...auditContext(req),
  })
  sendCreated(res, competitor)
})

/** PUT /api/v1/management/competitors/:id?hotelId= */
export const updateCompetitor = asyncHandler(async (req: Request, res: Response) => {
  const competitor = await updateCompetitorService(req.params.id, hotelIdFromQuery(req), req.body)
  await writeAuditLog({
    tenantId: competitor?.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'Competitor',
    entityId: req.params.id,
    newValue: req.body,
    ...auditContext(req),
  })
  sendSuccess(res, competitor, 200, '競合ホテルを更新しました')
})

/** DELETE /api/v1/management/competitors/:id?hotelId=（論理削除） */
export const deactivateCompetitor = asyncHandler(async (req: Request, res: Response) => {
  await deactivateCompetitorService(req.params.id, hotelIdFromQuery(req))
  await writeAuditLog({
    tenantId: req.user!.tenantId,
    userId: req.user!.userId,
    action: 'DELETE',
    entity: 'Competitor',
    entityId: req.params.id,
    ...auditContext(req),
  })
  sendDeleted(res, '競合ホテルを無効化しました')
})
