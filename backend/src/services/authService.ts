import { prisma } from '../lib/prisma.js'
import {
  hashPassword,
  verifyPasswordConstantWork,
  generateTokenPair,
  verifyRefreshToken,
  getRefreshTokenExpiry,
  hashToken,
} from '../lib/auth.js'
import { ApiError } from '../middlewares/errorHandler.js'
import { writeAuditLog } from './auditService.js'
import type { User, UserRole } from '@prisma/client'

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
  role?: UserRole
  hotelId?: string
}

interface RequestContext {
  ipAddress?: string
  userAgent?: string
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
 * ログイン失敗時に返す唯一のメッセージ（S-8）。
 * 「メールアドレスが存在しない」「パスワードが違う」「アカウントが無効」を
 * 区別できないようにするため、すべてこの文言・401 で返す。
 */
export const INVALID_CREDENTIALS_MESSAGE = 'メールアドレスまたはパスワードが正しくありません'

/**
 * ログイン失敗を監査ログに残す（S-6）。
 * ブルートフォース検知のため、失敗理由は監査ログにのみ記録し、
 * 呼び出し元がクライアントへ返すメッセージには含めない。
 */
async function recordLoginFailure(
  detail: { email: string; reason: string; tenantId?: string | null; userId?: string | null },
  ctx?: RequestContext
): Promise<void> {
  await writeAuditLog({
    tenantId: detail.tenantId ?? null,
    userId: detail.userId ?? null,
    action: 'LOGIN_FAILED',
    entity: 'User',
    entityId: detail.userId ?? null,
    newValue: { email: detail.email, reason: detail.reason },
    ipAddress: ctx?.ipAddress,
    userAgent: ctx?.userAgent,
  })
}

/**
 * ユーザーログイン
 */
export async function loginService(input: LoginInput, ctx?: RequestContext): Promise<AuthResult> {
  const { email, password } = input

  const user = await prisma.user.findUnique({
    where: { email },
  })

  // ユーザーが存在しない場合もダミーハッシュと比較して同じ計算量を消費する（S-8）。
  // 分岐より前に必ず 1 回 bcrypt を実行することで、応答時間からアカウントの有無を
  // 推測できないようにする。
  const isValidPassword = await verifyPasswordConstantWork(password, user?.password)

  // 「存在しない」「パスワード不一致」「無効化済み」を同一メッセージ・同一ステータスで返す（S-8）。
  // アカウント列挙と、有効／無効の判別を防ぐ。失敗理由は監査ログにのみ残す。
  if (!user || !isValidPassword || !user.isActive) {
    const reason = !user ? 'USER_NOT_FOUND' : !isValidPassword ? 'BAD_PASSWORD' : 'INACTIVE'
    await recordLoginFailure(
      { email, reason, tenantId: user?.tenantId ?? null, userId: user?.id ?? null },
      ctx
    )
    throw new ApiError(401, INVALID_CREDENTIALS_MESSAGE)
  }

  const tokens = generateTokenPair(user)

  // 期限切れのリフレッシュトークンを掃除する（S-9）。
  // ログアウトせずにセッションを切ると行が残り続けるため、ログインのたびに
  // 当該ユーザーぶんの失効済みトークンを削除する（@@index([expiresAt]) を使用）。
  await prisma.refreshToken.deleteMany({
    where: { userId: user.id, expiresAt: { lt: new Date() } },
  })

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

  const { password: _, ...userWithoutPassword } = user

  return {
    user: userWithoutPassword,
    tokens,
  }
}

/**
 * ユーザー登録（運営 / ADMIN、および自テナント内の MANAGER — N-3 / #52 / #62）
 *
 * テナント分離のため公開登録は提供しない。作成されるユーザーの tenantId は
 * リクエスト側で任意指定させず、テナント側のロール（ADMIN / MANAGER）が作る場合は
 * **作成者自身のテナント**を使う。hotelId から導出すると、他テナントのホテルIDを
 * 送るだけで他テナントにユーザーを作れてしまうため（#52）。
 * 運営（PLATFORM_ADMIN）は自分のテナントを持たないので、従来どおり hotelId の
 * 所属テナントから導出する。
 *
 * ロール別の制約（権限昇格・テナント越えの防止）:
 * - PLATFORM_ADMIN（運営）: テナント横断可。PLATFORM_ADMIN を作れる唯一のロール
 * - ADMIN（テナント管理者）: 自テナント内のみ。ADMIN / MANAGER / OPERATOR を作れる
 * - MANAGER: 自テナント内のみ。hotelId 必須で、ADMIN / PLATFORM_ADMIN は付与できない
 */
export async function registerService(
  input: RegisterInput,
  createdBy: { userId: string; tenantId: string | null; role: UserRole },
  ctx?: RequestContext
): Promise<Omit<User, 'password'>> {
  const { email, password, name, role, hotelId } = input
  const isPlatformAdmin = createdBy.role === 'PLATFORM_ADMIN'
  const isTenantManager = createdBy.role === 'MANAGER'

  // 運営ロールを作れるのは運営だけ（テナント側から運営権限が生えないようにする — #62）
  if (role === 'PLATFORM_ADMIN' && !isPlatformAdmin) {
    throw new ApiError(403, '運営（PLATFORM_ADMIN）ロールを付与できるのは運営のみです')
  }

  if (isTenantManager) {
    if (!hotelId) {
      throw new ApiError(400, 'ホテルIDは必須です')
    }
    if (role === 'ADMIN') {
      throw new ApiError(403, 'ADMIN ロールを付与できるのは ADMIN のみです')
    }
  }

  // テナント側のロールは自分のテナントに属していなければユーザーを作れない
  if (!isPlatformAdmin && !createdBy.tenantId) {
    throw new ApiError(403, 'テナントに所属していないため、ユーザーを作成できません')
  }

  const existingUser = await prisma.user.findUnique({
    where: { email },
  })

  if (existingUser) {
    throw new ApiError(409, 'このメールアドレスは既に登録されています')
  }

  let tenantId: string | null = isPlatformAdmin ? null : createdBy.tenantId

  if (hotelId) {
    // テナント側のロールでは、自テナントのホテルに限定して検索する。
    // 他テナントのホテルIDを送られても「見つからない」と同じ 400 になり、
    // そのホテルが存在するかどうかは判別できない（#52）
    const hotel = await prisma.hotel.findFirst({
      where: {
        id: hotelId,
        isActive: true,
        ...(!isPlatformAdmin && { tenantId: createdBy.tenantId as string }),
      },
    })

    if (!hotel) {
      throw new ApiError(400, '指定されたホテルが見つかりません')
    }

    tenantId = hotel.tenantId
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
 * トークンをリフレッシュ（ローテーション方式）
 */
export async function refreshTokenService(refreshToken: string): Promise<AuthResult> {
  verifyRefreshToken(refreshToken)

  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
    include: { user: true },
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

  const { password: _, ...userWithoutPassword } = storedToken.user

  return {
    user: userWithoutPassword,
    tokens,
  }
}

/**
 * ログアウト
 */
export async function logoutService(
  refreshToken: string,
  actor: { userId: string; tenantId: string | null },
  ctx?: RequestContext
): Promise<void> {
  await prisma.refreshToken.deleteMany({
    where: {
      tokenHash: hashToken(refreshToken),
      userId: actor.userId,
    },
  })

  await writeAuditLog({
    tenantId: actor.tenantId,
    userId: actor.userId,
    action: 'LOGOUT',
    entity: 'User',
    entityId: actor.userId,
    newValue: { scope: 'current' },
    ipAddress: ctx?.ipAddress,
    userAgent: ctx?.userAgent,
  })
}

/**
 * 全デバイスからログアウト
 */
export async function logoutAllService(
  actor: { userId: string; tenantId: string | null },
  ctx?: RequestContext
): Promise<void> {
  await prisma.refreshToken.deleteMany({
    where: { userId: actor.userId },
  })

  await writeAuditLog({
    tenantId: actor.tenantId,
    userId: actor.userId,
    action: 'LOGOUT',
    entity: 'User',
    entityId: actor.userId,
    newValue: { scope: 'all' },
    ipAddress: ctx?.ipAddress,
    userAgent: ctx?.userAgent,
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
