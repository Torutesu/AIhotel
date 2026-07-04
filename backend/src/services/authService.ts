import { prisma } from '../lib/prisma.js'
import {
  hashPassword,
  verifyPassword,
  generateTokenPair,
  verifyRefreshToken,
  getRefreshTokenExpiry,
} from '../lib/auth.js'
import { ApiError } from '../middlewares/errorHandler.js'
import type { User } from '@prisma/client'

// ======================================
// Types
// ======================================

interface LoginInput {
  email: string
  password: string
}

interface RegisterInput {
  email: string
  password: string
  name: string
  hotelId?: string
}

interface AuthResult {
  user: Omit<User, 'password'>
  tokens: {
    accessToken: string
    refreshToken: string
  }
}

// ======================================
// Service Functions
// ======================================

/**
 * ユーザーログイン
 */
export async function loginService(input: LoginInput): Promise<AuthResult> {
  const { email, password } = input

  // ユーザーを検索
  const user = await prisma.user.findUnique({
    where: { email },
  })

  if (!user) {
    throw new ApiError(401, 'メールアドレスまたはパスワードが正しくありません')
  }

  if (!user.isActive) {
    throw new ApiError(401, 'このアカウントは無効化されています')
  }

  // パスワードを検証
  const isValidPassword = await verifyPassword(password, user.password)

  if (!isValidPassword) {
    throw new ApiError(401, 'メールアドレスまたはパスワードが正しくありません')
  }

  // トークンを生成
  const tokens = generateTokenPair(user)

  // リフレッシュトークンをDBに保存
  await prisma.refreshToken.create({
    data: {
      token: tokens.refreshToken,
      userId: user.id,
      expiresAt: getRefreshTokenExpiry(),
    },
  })

  // 最終ログイン日時を更新
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  })

  // パスワードを除外して返す
  const { password: _, ...userWithoutPassword } = user

  return {
    user: userWithoutPassword,
    tokens,
  }
}

/**
 * ユーザー登録
 */
export async function registerService(input: RegisterInput): Promise<AuthResult> {
  const { email, password, name, hotelId } = input

  // 既存ユーザーをチェック
  const existingUser = await prisma.user.findUnique({
    where: { email },
  })

  if (existingUser) {
    throw new ApiError(409, 'このメールアドレスは既に登録されています')
  }

  // ホテルIDが指定されている場合、存在確認
  if (hotelId) {
    const hotel = await prisma.hotel.findUnique({
      where: { id: hotelId },
    })

    if (!hotel) {
      throw new ApiError(400, '指定されたホテルが見つかりません')
    }
  }

  // パスワードをハッシュ化
  const hashedPassword = await hashPassword(password)

  // ユーザーを作成
  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      name,
      hotelId,
    },
  })

  // トークンを生成
  const tokens = generateTokenPair(user)

  // リフレッシュトークンをDBに保存
  await prisma.refreshToken.create({
    data: {
      token: tokens.refreshToken,
      userId: user.id,
      expiresAt: getRefreshTokenExpiry(),
    },
  })

  // パスワードを除外して返す
  const { password: _, ...userWithoutPassword } = user

  return {
    user: userWithoutPassword,
    tokens,
  }
}

/**
 * トークンをリフレッシュ
 */
export async function refreshTokenService(refreshToken: string): Promise<AuthResult> {
  // リフレッシュトークンを検証
  verifyRefreshToken(refreshToken)

  // DBからリフレッシュトークンを検索
  const storedToken = await prisma.refreshToken.findUnique({
    where: { token: refreshToken },
    include: { user: true },
  })

  if (!storedToken) {
    throw new ApiError(401, '無効なリフレッシュトークンです')
  }

  if (storedToken.expiresAt < new Date()) {
    // 期限切れのトークンを削除
    await prisma.refreshToken.delete({
      where: { id: storedToken.id },
    })
    throw new ApiError(401, 'リフレッシュトークンの有効期限が切れています')
  }

  if (!storedToken.user.isActive) {
    throw new ApiError(401, 'このアカウントは無効化されています')
  }

  // 古いリフレッシュトークンを削除
  await prisma.refreshToken.delete({
    where: { id: storedToken.id },
  })

  // 新しいトークンを生成
  const tokens = generateTokenPair(storedToken.user)

  // 新しいリフレッシュトークンをDBに保存
  await prisma.refreshToken.create({
    data: {
      token: tokens.refreshToken,
      userId: storedToken.user.id,
      expiresAt: getRefreshTokenExpiry(),
    },
  })

  // パスワードを除外して返す
  const { password: _, ...userWithoutPassword } = storedToken.user

  return {
    user: userWithoutPassword,
    tokens,
  }
}

/**
 * ログアウト
 */
export async function logoutService(refreshToken: string, userId: string): Promise<void> {
  // 指定されたリフレッシュトークンを削除
  await prisma.refreshToken.deleteMany({
    where: {
      token: refreshToken,
      userId,
    },
  })
}

/**
 * 全デバイスからログアウト
 */
export async function logoutAllService(userId: string): Promise<void> {
  // ユーザーの全てのリフレッシュトークンを削除
  await prisma.refreshToken.deleteMany({
    where: { userId },
  })
}

/**
 * 現在のユーザー情報を取得
 */
export async function getMeService(userId: string): Promise<Omit<User, 'password'>> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      hotel: true,
    },
  })

  if (!user) {
    throw new ApiError(404, 'ユーザーが見つかりません')
  }

  const { password: _, ...userWithoutPassword } = user

  return userWithoutPassword
}
