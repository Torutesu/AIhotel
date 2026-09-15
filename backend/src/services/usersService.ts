import type { User, UserRole } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { ApiError, BadRequestError, NotFoundError } from '../middlewares/errorHandler.js'
import { registerSchema, type UpdateUserInput } from '../lib/validators.js'
import { hashPassword } from '../lib/auth.js'

// ユーザー管理（N-3 / #62）。
//
// 操作できるのは ADMIN（テナント管理者）・MANAGER と、運営（PLATFORM_ADMIN）のみ
// （ルータで requireRole 済み）。
// テナント越えの参照・更新を防ぐため、運営以外は ADMIN を含めて必ず actor.tenantId で絞り込む。

/** レスポンスに含めるユーザー項目（password は返さない） */
export type SafeUser = Omit<User, 'password'>

/** 操作を行うユーザー（JWT ペイロード由来） */
export interface UserActor {
  userId: string
  tenantId: string | null
  role: UserRole
}

function stripPassword(user: User): SafeUser {
  const { password: _, ...rest } = user
  return rest
}

/**
 * ホテルが属するテナントのユーザー一覧（N-3）。
 *
 * hotelId で受け取るのは、フロントが「いま見ているホテル」しか持っていないため。
 * 実際の絞り込みはそのホテルのテナント単位で行うので、hotelId が null の
 * テナント横断ユーザー（N-6）も一覧に含まれる。
 * ホテルへのアクセス権はルータの requireHotelAccess が検証済み。
 */
/** `bootstrapPlatformAdminService` の入力。パスワード規則は registerSchema と同じ */
export interface BootstrapPlatformAdminInput {
  email: string
  password: string
  name: string
}

export type BootstrapPlatformAdminResult =
  | { created: true; user: SafeUser }
  /** 既に運営が存在する（このメールとは限らない）。何も変更しない */
  | { created: false; existingPlatformAdmins: number }

/**
 * 本番の最初の運営（PLATFORM_ADMIN）を作る（docs/deploy-runbook.md §3-4）。
 *
 * `POST /auth/register` は認証必須で、運営ロールを付与できるのも運営だけ（#62）なので、
 * 空のデータベースには「最初の運営」を作る経路が無い。seed はデモアカウントを既知の
 * パスワードで作るため本番に投入できない（AGENTS.md）。この関数はその 1 回だけを担う。
 *
 * 冪等: 運営が 1 人でも存在すれば何もしない（`created: false`）。既存の運営のパスワードを
 * この経路で上書きすることはできない — それは通常のユーザー管理で行う。
 */
export async function bootstrapPlatformAdminService(
  input: BootstrapPlatformAdminInput
): Promise<BootstrapPlatformAdminResult> {
  const parsed = registerSchema
    .pick({ email: true, password: true, name: true })
    .safeParse(input)
  if (!parsed.success) {
    const details = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')
    throw new ApiError(400, `運営アカウントの入力が不正です: ${details}`)
  }
  const { email, password, name } = parsed.data

  const existingPlatformAdmins = await prisma.user.count({
    where: { role: 'PLATFORM_ADMIN' },
  })
  if (existingPlatformAdmins > 0) {
    return { created: false, existingPlatformAdmins }
  }
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    throw new ApiError(409, 'このメールアドレスは既に登録されています')
  }

  const user = await prisma.user.create({
    data: {
      email,
      password: await hashPassword(password),
      name,
      role: 'PLATFORM_ADMIN',
      tenantId: null,
      hotelId: null,
      isActive: true,
    },
  })
  return { created: true, user: stripPassword(user) }
}

export async function listUsersService(hotelId: string): Promise<SafeUser[]> {
  const hotel = await prisma.hotel.findFirst({
    where: { id: hotelId, isActive: true },
    select: { tenantId: true },
  })
  if (!hotel) throw new NotFoundError('ホテル')

  const users = await prisma.user.findMany({
    where: { tenantId: hotel.tenantId },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
  })
  return users.map(stripPassword)
}

/**
 * ユーザー更新（名前・ロール・有効/無効 — N-3 / #62）。
 *
 * 不変条件:
 * - 運営（PLATFORM_ADMIN）以外は ADMIN を含め自テナントのユーザーしか操作できない
 *   （他テナントは 404 = 存在を漏らさない）
 * - 運営ユーザーの変更と運営ロールの付与は運営のみ（テナント側から運営権限が生えないようにする）
 * - MANAGER は ADMIN ユーザーを操作できず、ADMIN ロールも付与できない（権限昇格の防止）
 * - 自分自身の無効化・ロール変更はできない（最後の管理者が自分を締め出す事故の防止）
 */
export async function updateUserService(
  id: string,
  input: UpdateUserInput,
  actor: UserActor
): Promise<{ before: SafeUser; after: SafeUser }> {
  const isPlatformAdmin = actor.role === 'PLATFORM_ADMIN'

  // 運営以外はテナント条件を必ず付ける（ADMIN も例外ではない — #62）。
  // 該当なしは 403 ではなく 404 にして
  // 「他テナントに、そのIDのユーザーが存在するか」を判別できないようにする
  const before = await prisma.user.findFirst({
    where: {
      id,
      ...(!isPlatformAdmin && { tenantId: actor.tenantId ?? '__no_tenant__' }),
    },
  })
  if (!before) throw new NotFoundError('ユーザー')

  // 運営ユーザーの変更・運営ロールの付与は運営だけに許す。
  // テナント管理者（ADMIN）が自分やほかのユーザーを運営に昇格できると
  // テナント境界が実質無効になるため（#62）
  if (!isPlatformAdmin) {
    if (before.role === 'PLATFORM_ADMIN') {
      throw new ApiError(403, '運営（PLATFORM_ADMIN）ユーザーを変更できるのは運営のみです')
    }
    if (input.role === 'PLATFORM_ADMIN') {
      throw new ApiError(403, '運営（PLATFORM_ADMIN）ロールを付与できるのは運営のみです')
    }
  }

  if (actor.role !== 'ADMIN' && !isPlatformAdmin) {
    if (before.role === 'ADMIN') {
      throw new ApiError(403, 'ADMIN ユーザーを変更できるのは ADMIN のみです')
    }
    if (input.role === 'ADMIN') {
      throw new ApiError(403, 'ADMIN ロールを付与できるのは ADMIN のみです')
    }
  }

  if (id === actor.userId) {
    if (input.isActive === false) {
      throw new BadRequestError('自分自身を無効化することはできません')
    }
    if (input.role !== undefined && input.role !== before.role) {
      throw new BadRequestError('自分自身のロールを変更することはできません')
    }
  }

  const after = await prisma.user.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.role !== undefined && { role: input.role }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    },
  })

  // 無効化したユーザーのセッションは即座に断つ（リフレッシュトークンを全削除）。
  // アクセストークンは短命なので、これで実質的にログアウトさせられる
  if (input.isActive === false) {
    await prisma.refreshToken.deleteMany({ where: { userId: id } })
  }

  return { before: stripPassword(before), after: stripPassword(after) }
}
