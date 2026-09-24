import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import { listUsersService, resetUserPasswordService, updateUserService } from '../services/usersService.js'
import type { UpdateUserInput } from '../lib/validators.js'
import { sendTemporaryPasswordMail } from '../services/accountMailService.js'

/**
 * ユーザー一覧（自テナントの ADMIN / MANAGER、および運営 — N-3 / #62）
 * GET /api/v1/users?hotelId=
 */
export const getUsers = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  const actor = req.user!
  const users = await listUsersService(hotelId, {
    userId: actor.userId,
    tenantId: actor.tenantId,
    role: actor.role,
    hotelId: actor.hotelId,
  })
  sendSuccess(res, users)
})

/**
 * ユーザー更新（名前・ロール・有効/無効。自テナントの ADMIN / MANAGER、および運営 — N-3 / #62）
 * PUT /api/v1/users/:id
 */
export const putUser = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as UpdateUserInput
  const actor = req.user!
  const { before, after } = await updateUserService(req.params.id, input, {
    userId: actor.userId,
    tenantId: actor.tenantId,
    role: actor.role,
    hotelId: actor.hotelId,
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

/**
 * 一時パスワードの発行（ADMIN / MANAGER・監査対象 — #89）
 * POST /api/v1/users/:id/reset-password
 * メール送信が有効なら本人にメールで届け、レスポンスには一時パスワードを含めない。
 * 届けられなければこのレスポンスで1回だけ返す。いずれの場合も監査ログには残さない
 */
export const resetUserPassword = asyncHandler(async (req: Request, res: Response) => {
  const actor = req.user!
  const { user, temporaryPassword } = await resetUserPasswordService(req.params.id, {
    userId: actor.userId,
    tenantId: actor.tenantId,
    role: actor.role,
    hotelId: actor.hotelId,
  })

  const emailSent = await sendTemporaryPasswordMail({
    kind: 'reset',
    to: user.email,
    name: user.name,
    temporaryPassword,
  })

  await writeAuditLog({
    tenantId: user.tenantId,
    userId: actor.userId,
    action: 'PASSWORD_RESET',
    entity: 'User',
    entityId: user.id,
    newValue: { email: user.email, emailSent },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })

  sendSuccess(
    res,
    { user, emailSent, temporaryPassword: emailSent ? null : temporaryPassword },
    200,
    emailSent ? '一時パスワードを本人にメールで送信しました' : '一時パスワードを発行しました'
  )
})
