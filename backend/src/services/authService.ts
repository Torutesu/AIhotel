import { prisma, runWithRlsBypass } from '../lib/prisma.js'
import {
  hashPassword,
  verifyPassword,
  generateTokenPair,
  verifyRefreshToken,
  getRefreshTokenExpiry,
  hashToken,
} from '../lib/auth.js'
import { ApiError } from '../middlewares/errorHandler.js'
import { config } from '../lib/config.js'
import { extractTenantCodeFromHost } from '../lib/tenantResolver.js'
import { writeAuditLog } from './auditService.js'
import type { User, UserRole } from '@prisma/client'

// ======================================
// Types
// ======================================

interface LoginInput {
  email: string
  password: string
  /** 組織コード。サブドメインで特定できない場合の手段（D-02 / D-08） */
  tenantCode?: string
}

interface RegisterInput {
  email: string
  password: string
  name: string
  role?: UserRole
  hotelId?: string
}

interface RequestContext {
  ipAddress?: string
  userAgent?: string
  /** リクエストの Host ヘッダー。サブドメインからテナントを特定する（D-08） */
  host?: string
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
 * ユーザーログイン。
 * テナントはサブドメイン（D-08）または組織コードで特定するが、
 * テナントコードから内部IDを引く時点ではまだテナントが確定していないため、
 * この経路だけテナント横断を許可する（D-01 の狭い例外）。
 */
export async function loginService(input: LoginInput, ctx?: RequestContext): Promise<AuthResult> {
  return runWithRlsBypass(() => loginInternal(input, ctx))
}

/** ログイン対象ユーザーの検索結果に含めるテナント情報 */
const tenantSelect = { tenant: { select: { isActive: true } } }

/**
 * ログインするテナントを決める（D-08）。
 * 1. サブドメイン（本番。ユーザーは何も入力しなくてよい）
 * 2. 明示的な組織コード（ローカル開発・API利用・兼務者）
 */
function resolveTenantCode(input: LoginInput, ctx?: RequestContext): string | null {
  const fromHost = extractTenantCodeFromHost(ctx?.host, config.APP_BASE_DOMAIN)
  if (fromHost) return fromHost
  const fromInput = input.tenantCode?.trim().toLowerCase()
  return fromInput || null
}

async function loginInternal(input: LoginInput, ctx?: RequestContext): Promise<AuthResult> {
  const { email, password } = input
  const tenantCode = resolveTenantCode(input, ctx)

  let user
  if (tenantCode) {
    // テナントが特定できている場合はその中だけを探す
    const tenant = await prisma.tenant.findUnique({ where: { code: tenantCode } })
    user = tenant
      ? await prisma.user.findUnique({
          where: { tenantId_email: { tenantId: tenant.id, email } },
          include: tenantSelect,
        })
      : null
  } else {
    // テナント未特定。該当が1件に定まる場合のみ許可する。
    // 提供側ADMIN（tenantId なし）もこの経路でログインする
    const candidates = await prisma.user.findMany({
      where: { email },
      include: tenantSelect,
      take: 2,
    })
    if (candidates.length > 1) {
      throw new ApiError(
        409,
        '複数の組織で同じメールアドレスが登録されています。組織コードを指定してください',
        [{ field: 'tenantCode', message: '組織コードを入力してください' }]
      )
    }
    user = candidates[0] ?? null
  }

  if (!user) {
    throw new ApiError(401, 'メールアドレスまたはパスワードが正しくありません')
  }

  if (!user.isActive) {
    throw new ApiError(401, 'このアカウントは無効化されています')
  }

  // 解約・停止テナントのユーザーはログイン不可（ユーザー個別の無効化を待たない）
  if (user.tenant && !user.tenant.isActive) {
    throw new ApiError(401, 'ご契約が無効化されています。サポートにお問い合わせください')
  }

  const isValidPassword = await verifyPassword(password, user.password)

  if (!isValidPassword) {
    throw new ApiError(401, 'メールアドレスまたはパスワードが正しくありません')
  }

  const tokens = generateTokenPair(user)

  // リフレッシュトークンはハッシュのみ保存する
  await prisma.refreshToken.create({
    data: {
      tokenHash: hashToken(tokens.refreshToken),
      userId: user.id,
      tenantId: user.tenantId,
      expiresAt: getRefreshTokenExpiry(),
    },
  })

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  })

  await writeAuditLog({
    tenantId: user.tenantId,
    userId: user.id,
    action: 'LOGIN',
    entity: 'User',
    entityId: user.id,
    ipAddress: ctx?.ipAddress,
    userAgent: ctx?.userAgent,
  })

  const { password: _, tenant: _tenant, ...userWithoutPassword } = user

  return {
    user: userWithoutPassword,
    tokens,
  }
}

/**
 * ユーザー登録（ADMIN専用）
 *
 * テナント分離のため公開登録は提供しない。作成されるユーザーの tenantId は
 * hotelId の所属テナントから導出し、リクエスト側で任意指定させない。
 */
export async function registerService(
  input: RegisterInput,
  createdBy: { userId: string; tenantId: string | null },
  ctx?: RequestContext
): Promise<Omit<User, 'password'>> {
  const { email, password, name, role, hotelId } = input

  let tenantId: string | null = null

  if (hotelId) {
    const hotel = await prisma.hotel.findUnique({
      where: { id: hotelId },
    })

    if (!hotel) {
      throw new ApiError(400, '指定されたホテルが見つかりません')
    }

    tenantId = hotel.tenantId
  }

  // メールはテナント単位で一意（D-02）。別テナントでの利用は妨げない
  const existingUser = await prisma.user.findFirst({
    where: { email, tenantId },
  })

  if (existingUser) {
    throw new ApiError(409, 'このメールアドレスは既にこの組織で登録されています')
  }

  const hashedPassword = await hashPassword(password)

  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      name,
      role,
      hotelId,
      tenantId,
    },
  })

  await writeAuditLog({
    tenantId,
    userId: createdBy.userId,
    action: 'CREATE',
    entity: 'User',
    entityId: user.id,
    newValue: { email: user.email, name: user.name, role: user.role, hotelId: user.hotelId },
    ipAddress: ctx?.ipAddress,
    userAgent: ctx?.userAgent,
  })

  const { password: _, ...userWithoutPassword } = user

  return userWithoutPassword
}

/**
 * トークンをリフレッシュ（ローテーション方式）。
 * 保存済みトークンからユーザーを引くまでテナントが確定しないため、
 * ログインと同様にテナント横断を許可する（D-01 の狭い例外）。
 */
export async function refreshTokenService(refreshToken: string): Promise<AuthResult> {
  return runWithRlsBypass(() => refreshTokenInternal(refreshToken))
}

async function refreshTokenInternal(refreshToken: string): Promise<AuthResult> {
  verifyRefreshToken(refreshToken)

  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
    include: { user: { include: { tenant: { select: { isActive: true } } } } },
  })

  if (!storedToken) {
    throw new ApiError(401, '無効なリフレッシュトークンです')
  }

  if (storedToken.expiresAt < new Date()) {
    await prisma.refreshToken.delete({
      where: { id: storedToken.id },
    })
    throw new ApiError(401, 'リフレッシュトークンの有効期限が切れています')
  }

  if (!storedToken.user.isActive) {
    throw new ApiError(401, 'このアカウントは無効化されています')
  }

  // 解約・停止テナントはリフレッシュも拒否する（ログインと同基準）
  if (storedToken.user.tenant && !storedToken.user.tenant.isActive) {
    throw new ApiError(401, 'ご契約が無効化されています。サポートにお問い合わせください')
  }

  // 使用済みトークンは失効させ、新しいペアを発行する
  await prisma.refreshToken.delete({
    where: { id: storedToken.id },
  })

  const tokens = generateTokenPair(storedToken.user)

  await prisma.refreshToken.create({
    data: {
      tokenHash: hashToken(tokens.refreshToken),
      userId: storedToken.user.id,
      tenantId: storedToken.user.tenantId,
      expiresAt: getRefreshTokenExpiry(),
    },
  })

  const { password: _, tenant: _tenant, ...userWithoutPassword } = storedToken.user

  return {
    user: userWithoutPassword,
    tokens,
  }
}

/**
 * ログアウト
 */
export async function logoutService(refreshToken: string, userId: string): Promise<void> {
  await prisma.refreshToken.deleteMany({
    where: {
      tokenHash: hashToken(refreshToken),
      userId,
    },
  })
}

/**
 * 全デバイスからログアウト
 */
export async function logoutAllService(userId: string): Promise<void> {
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
