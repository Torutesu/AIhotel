import { createHash } from 'node:crypto'
import jwt, { type SignOptions } from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import type { User, UserRole } from '@prisma/client'
import { config } from './config.js'

// ======================================
// Types
// ======================================

export interface JWTPayload {
  userId: string
  email: string
  role: UserRole
  tenantId: string | null
  hotelId: string | null
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
}

// ======================================
// Configuration
// ======================================

// JWT_SECRET の必須検証（32文字以上・フォールバック禁止）は config.ts が起動時に行う
const JWT_SECRET: string = config.JWT_SECRET
const JWT_EXPIRES_IN = config.JWT_EXPIRES_IN
const JWT_REFRESH_EXPIRES_IN = config.JWT_REFRESH_EXPIRES_IN

// Convert string to seconds for JWT
function parseExpiresIn(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([dhms])$/)
  if (!match) return 86400 // default 24h in seconds
  
  const value = parseInt(match[1], 10)
  const unit = match[2]
  
  switch (unit) {
    case 'd': return value * 24 * 60 * 60
    case 'h': return value * 60 * 60
    case 'm': return value * 60
    case 's': return value
    default: return 86400
  }
}

// ======================================
// Password Utilities
// ======================================

/**
 * パスワードをハッシュ化する
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

/**
 * パスワードを検証する
 */
export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword)
}

// ======================================
// JWT Utilities
// ======================================

/**
 * アクセストークンを生成する
 */
export function generateAccessToken(
  user: Pick<User, 'id' | 'email' | 'role' | 'tenantId' | 'hotelId'>
): string {
  const payload: JWTPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
    hotelId: user.hotelId,
  }
  
  const options: SignOptions = {
    expiresIn: parseExpiresIn(JWT_EXPIRES_IN),
  }
  
  return jwt.sign(payload, JWT_SECRET, options)
}

/**
 * リフレッシュトークンを生成する
 */
export function generateRefreshToken(userId: string): string {
  const options: SignOptions = {
    expiresIn: parseExpiresIn(JWT_REFRESH_EXPIRES_IN),
  }
  
  return jwt.sign(
    { userId, type: 'refresh' },
    JWT_SECRET,
    options
  )
}

/**
 * トークンペアを生成する
 */
export function generateTokenPair(
  user: Pick<User, 'id' | 'email' | 'role' | 'tenantId' | 'hotelId'>
): TokenPair {
  return {
    accessToken: generateAccessToken(user),
    refreshToken: generateRefreshToken(user.id),
  }
}

/**
 * リフレッシュトークンのDB保存用ハッシュを計算する。
 * 生トークンを保存しないことで、DB漏洩時のセッション乗っ取りを防ぐ。
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * アクセストークンを検証する
 */
export function verifyAccessToken(token: string): JWTPayload {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload
    return decoded
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('トークンの有効期限が切れています')
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('無効なトークンです')
    }
    throw error
  }
}

/**
 * リフレッシュトークンを検証する
 */
export function verifyRefreshToken(token: string): { userId: string } {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; type: string }
    
    if (decoded.type !== 'refresh') {
      throw new Error('無効なリフレッシュトークンです')
    }
    
    return { userId: decoded.userId }
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('リフレッシュトークンの有効期限が切れています')
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('無効なリフレッシュトークンです')
    }
    throw error
  }
}

/**
 * リフレッシュトークンの有効期限を取得する（Date型）
 */
export function getRefreshTokenExpiry(): Date {
  const match = JWT_REFRESH_EXPIRES_IN.match(/^(\d+)([dhms])$/)
  if (!match) {
    // デフォルト7日
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  }
  
  const value = parseInt(match[1], 10)
  const unit = match[2]
  
  let ms: number
  switch (unit) {
    case 'd':
      ms = value * 24 * 60 * 60 * 1000
      break
    case 'h':
      ms = value * 60 * 60 * 1000
      break
    case 'm':
      ms = value * 60 * 1000
      break
    case 's':
      ms = value * 1000
      break
    default:
      ms = 7 * 24 * 60 * 60 * 1000
  }
  
  return new Date(Date.now() + ms)
}
