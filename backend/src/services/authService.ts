import { prisma } from '../lib/prisma.js'
import {
  verifyPassword,
  hashPassword,
  verifyPasswordConstantWork,
  generateTokenPair,
  verifyRefreshToken,
  getRefreshTokenExpiry,
  hashToken,
} from '../lib/auth.js'
import { ApiError, BadRequestError } from '../middlewares/errorHandler.js'
import { writeAuditLog } from './auditService.js'
import { logger } from '../utils/logger.js'
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
  /** 運営だけが指定できる所属テナント（#81） */
  tenantId?: string
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

/** 連続でこの回数だけ失敗するとアカウントをロックする（#78） */
export const MAX_FAILED_LOGIN_ATTEMPTS = 5
/** ロックの長さ（#78） */
export const ACCOUNT_LOCK_MINUTES = 15

/**
 * パスワード不一致を数え、上限に達したらアカウントをロックする（#78）。
 *
 * increment で数えるので、同時に届いた失敗も取りこぼさない。ロックしたら回数は 0 に戻し、
 * ロックが明けたら再び上限まで試せるようにする。ロックは監査ログ ACCOUNT_LOCKED に残す。
 */
async function registerFailedPassword(
  user: { id: string; tenantId: string | null; email: string },
  ctx?: RequestContext
): Promise<void> {
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: { increment: 1 } },
    select: { failedLoginCount: true },
  })
  if (updated.failedLoginCount < MAX_FAILED_LOGIN_ATTEMPTS) return

  const lockedUntil = new Date(Date.now() + ACCOUNT_LOCK_MINUTES * 60_000)
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil },
  })
  await writeAuditLog({
    tenantId: user.tenantId,
    userId: user.id,
    action: 'ACCOUNT_LOCKED',
    entity: 'User',
    entityId: user.id,
    newValue: { email: user.email, lockedUntil: lockedUntil.toISOString() },
    ipAddress: ctx?.ipAddress,
    userAgent: ctx?.userAgent,
  })
}

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
 * アクセストークンの主体を DB の現在の状態で解決する（#78）。
 *
 * アクセストークンは署名だけで検証できるため、そのままでは無効化・降格・
 * テナントの契約停止が有効期限まで反映されない。authenticate が毎リクエスト
 * これを呼び、ユーザーが無効・存在しない、またはテナントが停止されていれば null を返す。
 * ロール・所属は常にこの戻り値（DB の値）を正とし、トークンの中身は信用しない。
 * 主キー検索＋テナントの結合1回なので、1リクエストあたりのコストは小さい。
 */
export async function resolveAuthSubjectService(userId: string): Promise<{
  userId: string
  email: string
  role: UserRole
  tenantId: string | null
  hotelId: string | null
  /** 一時パスワードの変更待ち（#89）。authenticate が使える API を絞る */
  mustChangePassword: boolean
} | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      tenantId: true,
      hotelId: true,
      isActive: true,
      mustChangePassword: true,
      tenant: { select: { isActive: true } },
    },
  })
  if (!user || !user.isActive) return null
  // テナントに属するユーザーは、テナントが停止されていれば使えない（運営は tenant を持たない）
  if (user.tenant && !user.tenant.isActive) return null

  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
    hotelId: user.hotelId,
    mustChangePassword: user.mustChangePassword,
  }
}

/**
 * ユーザーログイン
 */
export async function loginService(input: LoginInput, ctx?: RequestContext): Promise<AuthResult> {
  const { email, password } = input

  const user = await prisma.user.findUnique({
    where: { email },
    include: { tenant: { select: { isActive: true } } },
  })

  // ユーザーが存在しない場合もダミーハッシュと比較して同じ計算量を消費する（S-8）。
  // 分岐より前に必ず 1 回 bcrypt を実行することで、応答時間からアカウントの有無を
  // 推測できないようにする。
  const isValidPassword = await verifyPasswordConstantWork(password, user?.password)

  // 「存在しない」「パスワード不一致」「無効化済み」「テナント停止中」「ロック中」を
  // 同一メッセージ・同一ステータスで返す（S-8 / #78）。
  // アカウント列挙と、有効／無効・ロック状態の判別を防ぐ。失敗理由は監査ログにのみ残す。
  // ロック中は正しいパスワードでも通さない（通すとロックが総当たりの妨げにならない）
  const tenantSuspended = Boolean(user?.tenant && !user.tenant.isActive)
  const locked = Boolean(user?.lockedUntil && user.lockedUntil > new Date())
  if (!user || locked || !isValidPassword || !user.isActive || tenantSuspended) {
    const reason = !user
      ? 'USER_NOT_FOUND'
      : locked
        ? 'LOCKED'
        : !isValidPassword
          ? 'BAD_PASSWORD'
          : !user.isActive
            ? 'INACTIVE'
            : 'TENANT_SUSPENDED'
    if (user && !locked && !isValidPassword) {
      await registerFailedPassword(user, ctx)
    }
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

  // 成功したら連続失敗の回数とロックを解除する（#78）
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
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
  const { email, password, name, role, hotelId, tenantId: requestedTenantId } = input
  const isPlatformAdmin = createdBy.role === 'PLATFORM_ADMIN'

  // テナントの直接指定は運営だけ（#81）。テナント側のロールは自テナントにしか作れない
  if (requestedTenantId !== undefined && !isPlatformAdmin) {
    throw new ApiError(403, 'テナントを指定してユーザーを作成できるのは運営のみです')
  }
  if (requestedTenantId !== undefined && role === 'PLATFORM_ADMIN') {
    throw new ApiError(400, '運営（PLATFORM_ADMIN）ユーザーはテナントに所属させられません')
  }
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

  if (requestedTenantId !== undefined) {
    const tenant = await prisma.tenant.findUnique({ where: { id: requestedTenantId } })
    if (!tenant) {
      throw new ApiError(400, '指定されたテナントが見つかりません')
    }
    tenantId = tenant.id
  }

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
    if (requestedTenantId !== undefined && hotel.tenantId !== requestedTenantId) {
      throw new ApiError(400, '指定されたホテルは指定されたテナントに属していません')
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
 * 回転直後の再提示を「盗用」ではなく「正規利用者の競合」とみなす猶予時間（#49-4）。
 * フロントエンドはリフレッシュを単一化しているため、これを超える再提示は通常発生しない。
 */
const REFRESH_REUSE_GRACE_MS = 10_000

/**
 * トークンをリフレッシュ（ローテーション方式 — #49-4）
 *
 * 回転済みのトークンは行を消さず `revokedAt` を立てて残す。こうすることで
 * 「既に使われたトークンがもう一度提示された」＝盗まれて再生された可能性を検知でき、
 * その場合は当該ユーザーの全リフレッシュトークンを失効させて全端末で再ログインを強制する。
 *
 * 失効と新規発行は1トランザクションで行う。分けて実行すると、削除と作成の間で
 * 落ちた場合にセッションだけが消える（ユーザーが理由なくログアウトされる）。
 */
export async function refreshTokenService(refreshToken: string): Promise<AuthResult> {
  // 署名不正・期限切れ・アクセストークンの流用（type クレーム違い）はすべて 401 にする。
  // verifyRefreshToken は素の Error を投げるため、そのままだと errorHandler が 500 にしてしまい、
  // クライアントが「再ログインが必要」を判別できなかった
  try {
    verifyRefreshToken(refreshToken)
  } catch (error) {
    throw new ApiError(401, error instanceof Error ? error.message : '無効なリフレッシュトークンです')
  }

  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
    include: { user: { include: { tenant: { select: { isActive: true } } } } },
  })

  if (!storedToken) {
    throw new ApiError(401, '無効なリフレッシュトークンです')
  }

  // 再利用検知: 一度回転させたトークンの再提示。
  //
  // ただし回転直後（猶予時間内）の再提示は、複数タブが同時にリフレッシュした等の
  // 正規利用者側の競合であることがほとんどなので、401 を返すだけに留める。
  // ここで全端末を切ると、タブを2枚開いていただけでログアウトされてしまう。
  // 猶予を過ぎてからの再提示は盗用として扱い、正規利用者ごとセッションを切る
  // （どちらが提示したか区別できない以上、攻撃者だけを切ることはできない）。
  if (storedToken.revokedAt) {
    if (Date.now() - storedToken.revokedAt.getTime() <= REFRESH_REUSE_GRACE_MS) {
      throw new ApiError(401, '無効なリフレッシュトークンです')
    }

    await prisma.refreshToken.deleteMany({ where: { userId: storedToken.userId } })
    await writeAuditLog({
      tenantId: storedToken.user.tenantId,
      userId: storedToken.userId,
      action: 'TOKEN_REUSE_DETECTED',
      entity: 'RefreshToken',
      entityId: storedToken.id,
      newValue: { revokedAt: storedToken.revokedAt, scope: 'all' },
    })
    logger.warn(
      { userId: storedToken.userId, tokenId: storedToken.id },
      '失効済みリフレッシュトークンが再提示されたため、当該ユーザーの全トークンを失効させました'
    )
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

  // テナントの契約停止中はトークンを更新させない（#78）
  if (storedToken.user.tenant && !storedToken.user.tenant.isActive) {
    throw new ApiError(401, 'このアカウントは現在利用できません')
  }

  const tokens = await prisma.$transaction(async (tx) => {
    // revokedAt: null を条件に含めることで、同時に届いた2本目のリフレッシュ要求は
    // count 0 になり、トークンが二重に発行されない（更新は行ロックで直列化される）。
    const revoked = await tx.refreshToken.updateMany({
      where: { id: storedToken.id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    if (revoked.count === 0) {
      throw new ApiError(401, '無効なリフレッシュトークンです')
    }

    const pair = generateTokenPair(storedToken.user)
    await tx.refreshToken.create({
      data: {
        tokenHash: hashToken(pair.refreshToken),
        userId: storedToken.user.id,
        tenantId: storedToken.user.tenantId,
        expiresAt: getRefreshTokenExpiry(),
      },
    })
    return pair
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

/**
 * 期限切れリフレッシュトークンの一括削除（#49-4）。
 *
 * ログイン時の掃除（S-9）はログインしたユーザーぶんしか消さないため、
 * 退職・長期未ログインのアカウントぶんが残り続ける。日次バッチから全体を掃除する。
 * 失効済み（revokedAt あり）の行も expiresAt を過ぎれば再利用検知の役目を終えるので同時に消す。
 */
export async function purgeExpiredRefreshTokensService(): Promise<{ deleted: number }> {
  const { count } = await prisma.refreshToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  })
  return { deleted: count }
}

/**
 * 本人によるパスワード変更（#89）。
 *
 * 現在のパスワードを確かめてから変更し、一時パスワードの変更待ちを解除する。
 * 盗まれたセッションを残さないよう本人のリフレッシュトークンをすべて失効させ、
 * この操作をした端末には新しいトークンを発行して返す（ログアウトさせない）。
 */
export async function changePasswordService(
  userId: string,
  input: { currentPassword: string; newPassword: string },
  ctx?: RequestContext
): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user || !user.isActive) throw new ApiError(401, 'このアカウントは現在利用できません')

  if (!(await verifyPassword(input.currentPassword, user.password))) {
    throw new BadRequestError('現在のパスワードが正しくありません', [
      { field: 'currentPassword', message: '現在のパスワードが正しくありません' },
    ])
  }

  const hashed = await hashPassword(input.newPassword)
  const tokens = generateTokenPair(user)
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.user.update({
      where: { id: user.id },
      data: { password: hashed, mustChangePassword: false },
    })
    await tx.refreshToken.deleteMany({ where: { userId: user.id } })
    await tx.refreshToken.create({
      data: {
        tokenHash: hashToken(tokens.refreshToken),
        userId: user.id,
        tenantId: user.tenantId,
        expiresAt: getRefreshTokenExpiry(),
      },
    })
    return next
  })

  await writeAuditLog({
    tenantId: user.tenantId,
    userId: user.id,
    action: 'PASSWORD_CHANGED',
    entity: 'User',
    entityId: user.id,
    ipAddress: ctx?.ipAddress,
    userAgent: ctx?.userAgent,
  })

  const { password: _, ...userWithoutPassword } = updated
  return { user: userWithoutPassword, tokens }
}
