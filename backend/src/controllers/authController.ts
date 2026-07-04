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
} from '../services/authService.js'
import type { LoginInput, RegisterInput } from '../lib/validators.js'

/**
 * ユーザーログイン
 * POST /api/v1/auth/login
 */
export const login = asyncHandler(async (req: Request, res: Response) => {
  const input: LoginInput = req.body
  const result = await loginService(input)
  sendSuccess(res, result, 200, 'ログインしました')
})

/**
 * ユーザー登録
 * POST /api/v1/auth/register
 */
export const register = asyncHandler(async (req: Request, res: Response) => {
  const input: RegisterInput = req.body
  const result = await registerService(input)
  sendCreated(res, result, 'ユーザーを登録しました')
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
  const userId = req.user!.userId
  await logoutService(refreshToken, userId)
  sendSuccess(res, null, 200, 'ログアウトしました')
})

/**
 * 全デバイスからログアウト
 * POST /api/v1/auth/logout-all
 */
export const logoutAll = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.userId
  await logoutAllService(userId)
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
