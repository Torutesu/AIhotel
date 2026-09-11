import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import { listUsersService, updateUserService } from '../services/usersService.js'
import type { UpdateUserInput } from '../lib/validators.js'

/**
 * ユーザー一覧（ADMIN / 自テナントの MANAGER — N-3）
 * GET /api/v1/users?hotelId=
 */
export const getUsers = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  const users = await listUsersService(hotelId)
  sendSuccess(res, users)
})

/**
 * ユーザー更新（名前・ロール・有効/無効。ADMIN / 自テナントの MANAGER — N-3）
 * PUT /api/v1/users/:id
 */
export const putUser = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as UpdateUserInput
  const actor = req.user!
  const { before, after } = await updateUserService(req.params.id, input, {
    userId: actor.userId,
    tenantId: actor.tenantId,
    role: actor.role,
  })

  await writeAuditLog({
    tenantId: before.tenantId,
    userId: actor.userId,
    action: 'UPDATE',
    entity: 'User',
    entityId: before.id,
    oldValue: { name: before.name, role: before.role, isActive: before.isActive },
    newValue: { name: after.name, role: after.role, isActive: after.isActive },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })

  sendSuccess(res, after, 200, 'ユーザーを更新しました')
})
