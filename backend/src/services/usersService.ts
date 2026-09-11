import type { User, UserRole } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { ApiError, BadRequestError, NotFoundError } from '../middlewares/errorHandler.js'
import type { UpdateUserInput } from '../lib/validators.js'

// ユーザー管理（N-3）。
//
// 操作できるのは ADMIN と、自テナント内の MANAGER のみ（ルータで requireRole 済み）。
// テナント越えの参照・更新を防ぐため、ADMIN 以外は必ず actor.tenantId で絞り込む。

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
 * ユーザー更新（名前・ロール・有効/無効 — N-3）。
 *
 * 不変条件:
 * - ADMIN 以外は自テナントのユーザーしか操作できない（他テナントは 404 = 存在を漏らさない）
 * - MANAGER は ADMIN ユーザーを操作できず、ADMIN ロールも付与できない（権限昇格の防止）
 * - 自分自身の無効化・ロール変更はできない（最後の管理者が自分を締め出す事故の防止）
 */
export async function updateUserService(
  id: string,
  input: UpdateUserInput,
  actor: UserActor
): Promise<{ before: SafeUser; after: SafeUser }> {
  // ADMIN 以外はテナント条件を必ず付ける。該当なしは 403 ではなく 404 にして
  // 「他テナントに、そのIDのユーザーが存在するか」を判別できないようにする
  const before = await prisma.user.findFirst({
    where: {
      id,
      ...(actor.role !== 'ADMIN' && { tenantId: actor.tenantId ?? '__no_tenant__' }),
    },
  })
  if (!before) throw new NotFoundError('ユーザー')

  if (actor.role !== 'ADMIN') {
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
