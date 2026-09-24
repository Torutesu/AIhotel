import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess, sendCreated } from '../utils/response.js'
import {
  loginService,
  registerService,
  refreshTokenService,
  logoutService,
  logoutAllService,
  getMeService,
  changePasswordService,
} from '../services/authService.js'
import type { ChangePasswordInput, LoginInput, RegisterInput } from '../lib/validators.js'
import { sendTemporaryPasswordMail } from '../services/accountMailService.js'

function requestContext(req: Request) {
  return {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  }
}

/**
 * ユーザーログイン
 * POST /api/v1/auth/login
 */
export const login = asyncHandler(async (req: Request, res: Response) => {
  const input: LoginInput = req.body
  const result = await loginService(input, requestContext(req))
  sendSuccess(res, result, 200, 'ログインしました')
})

/**
 * ユーザー登録（運営 / ADMIN、および自テナント内の MANAGER — N-3 / #62）
 * POST /api/v1/auth/register
 */
export const register = asyncHandler(async (req: Request, res: Response) => {
  const input: RegisterInput = req.body
  const createdBy = {
    userId: req.user!.userId,
    tenantId: req.user!.tenantId,
    role: req.user!.role,
    hotelId: req.user!.hotelId,
  }
  const { user, temporaryPassword } = await registerService(input, createdBy, requestContext(req))
  if (temporaryPassword === null) {
    sendCreated(res, { ...user, invitation: null }, 'ユーザーを登録しました')
    return
  }
  // 招待（#89）: メールで届けられたら一時パスワードは返さない。届けられなければ作成者に1回だけ見せる
  const emailSent = await sendTemporaryPasswordMail({
    kind: 'invite',
    to: user.email,
    name: user.name,
    temporaryPassword,
  })
  sendCreated(
    res,
    { ...user, invitation: { emailSent, temporaryPassword: emailSent ? null : temporaryPassword } },
    emailSent ? '招待メールを送信しました' : 'ユーザーを登録しました（一時パスワードを本人に伝えてください）'
  )
})

/**
 * トークンをリフレッシュ
 * POST /api/v1/auth/refresh
 */
export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body
  const result = await refreshTokenService(refreshToken)
  sendSuccess(res, result, 200, 'トークンを更新しました')
})

/**
 * ログアウト
 * POST /api/v1/auth/logout
 */
export const logout = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body
  const user = req.user!
  await logoutService(refreshToken, { userId: user.userId, tenantId: user.tenantId }, requestContext(req))
  sendSuccess(res, null, 200, 'ログアウトしました')
})

/**
 * 全デバイスからログアウト
 * POST /api/v1/auth/logout-all
 */
export const logoutAll = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!
  await logoutAllService({ userId: user.userId, tenantId: user.tenantId }, requestContext(req))
  sendSuccess(res, null, 200, '全デバイスからログアウトしました')
})

/**
 * 現在のユーザー情報を取得
 * GET /api/v1/auth/me
 */
export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId
  const user = await getMeService(userId)
  sendSuccess(res, user)
})

/**
 * 本人によるパスワード変更（#89）
 * PUT /api/v1/auth/password
 * 本人の全リフレッシュトークンを失効させ、この端末には新しいトークンを返す
 */
export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as ChangePasswordInput
  const result = await changePasswordService(req.user!.userId, input, requestContext(req))
  sendSuccess(res, result, 200, 'パスワードを変更しました')
})
