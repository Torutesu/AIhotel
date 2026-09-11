import { createHash, randomBytes } from 'node:crypto'
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

// トークン種別クレーム。アクセストークンとリフレッシュトークンは同じ秘密鍵で署名するため、
// type で区別しないとリフレッシュトークンを Bearer として流用できてしまう（S-1）
type TokenType = 'access' | 'refresh'

interface AccessTokenClaims extends JWTPayload {
  type: 'access'
}

interface RefreshTokenClaims {
  userId: string
  type: 'refresh'
  // トークンごとに一意な識別子。これが無いと、同じユーザーが同じ秒内に
  // 2回トークンを発行した場合（連続ログイン・同時リフレッシュ）に payload も iat も
  // 完全に一致し、まったく同じトークン文字列が生成される。
  // DB は tokenHash が @unique なので 2本目の保存が一意制約違反になり、
  // 回転そのものが失敗していた（#49-4）
  jti: string
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

const BCRYPT_COST = 12

/**
 * パスワードをハッシュ化する
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST)
}

/**
 * パスワードを検証する
 */
export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword)
}

// ログイン失敗時のタイミングオラクル対策用ダミーハッシュ（S-8）。
// 事前計算を防ぐためプロセス起動ごとにランダムな値から生成し、初回使用時にだけ計算する
// （起動を bcrypt のコストぶん遅らせないため遅延生成）。
let dummyPasswordHash: Promise<string> | null = null

function getDummyPasswordHash(): Promise<string> {
  dummyPasswordHash ??= bcrypt.hash(randomBytes(32).toString('hex'), BCRYPT_COST)
  return dummyPasswordHash
}

/**
 * パスワードを検証する。ハッシュが無い（＝該当ユーザーが存在しない）場合でも
 * 同じコストのダミーハッシュと比較し、常に false を返す（S-8）。
 *
 * ユーザーの有無で bcrypt を実行するかどうかが変わると、応答時間の差から
 * 登録済みメールアドレスを列挙できてしまうため、比較を必ず 1 回実行する。
 */
export async function verifyPasswordConstantWork(
  password: string,
  hashedPassword: string | null | undefined
): Promise<boolean> {
  const hash = hashedPassword ?? (await getDummyPasswordHash())
  const matches = await bcrypt.compare(password, hash)
  return hashedPassword ? matches : false
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
  const payload: AccessTokenClaims = {
    userId: user.id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
    hotelId: user.hotelId,
    type: 'access',
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

  const payload: RefreshTokenClaims = {
    userId,
    type: 'refresh',
    jti: randomBytes(16).toString('hex'),
  }
  return jwt.sign(payload, JWT_SECRET, options)
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
 * アクセストークンを検証する。
 * type クレームが 'access' でないトークン（リフレッシュトークン等）は署名が正しくても拒否する（S-1）
 */
export function verifyAccessToken(token: string): JWTPayload {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as Partial<AccessTokenClaims> & { type?: TokenType }

    if (decoded.type !== 'access' || typeof decoded.userId !== 'string') {
      throw new jwt.JsonWebTokenError('invalid token type')
    }

    return {
      userId: decoded.userId,
      email: decoded.email as string,
      role: decoded.role as UserRole,
      tenantId: decoded.tenantId ?? null,
      hotelId: decoded.hotelId ?? null,
    }
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
    const decoded = jwt.verify(token, JWT_SECRET) as Partial<RefreshTokenClaims> & { type?: TokenType }

    if (decoded.type !== 'refresh' || typeof decoded.userId !== 'string') {
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
