import type { UserRole } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { NotFoundError, BadRequestError } from '../middlewares/errorHandler.js'

// ホテル単位のユーザー管理。支配人が自施設のスタッフを扱えるようにする。
// 新規追加は招待メール（D-04）経由なので、ここでは一覧・権限変更・有効化切替のみ扱う。

// パスワードを返さないための select
const userPublicSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  hotelId: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
} as const

export async function listUsersService(hotelId: string) {
  return prisma.user.findMany({
    where: { hotelId },
    select: userPublicSelect,
    orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
  })
}

async function findManagedUser(id: string, hotelId: string) {
  const user = await prisma.user.findFirst({
    where: { id, hotelId },
    select: { ...userPublicSelect, tenantId: true },
  })
  if (!user) throw new NotFoundError('ユーザー')
  return user
}

/**
 * ロール変更。提供側ADMINへの昇格はここでは行わない
 * （ADMIN はシステム提供側専用のため）。
 */
export async function updateUserRoleService(
  id: string,
  hotelId: string,
  role: Exclude<UserRole, 'ADMIN'>,
  actor: { userId: string }
) {
  const user = await findManagedUser(id, hotelId)
  if (user.role === 'ADMIN') {
    throw new BadRequestError('提供側の管理者アカウントは変更できません')
  }
  if (user.id === actor.userId) {
    // 自分自身を降格させて誰も管理できなくなる事故を防ぐ
    throw new BadRequestError('自分自身の権限は変更できません')
  }

  await prisma.user.updateMany({ where: { id, hotelId }, data: { role } })
  return { ...user, role }
}

/**
 * 有効化・無効化。無効化時は既存セッションも破棄する
 * （無効化したのに使い続けられる状態を作らない）。
 */
export async function setUserActiveService(
  id: string,
  hotelId: string,
  isActive: boolean,
  actor: { userId: string }
) {
  const user = await findManagedUser(id, hotelId)
  if (user.role === 'ADMIN') {
    throw new BadRequestError('提供側の管理者アカウントは変更できません')
  }
  if (user.id === actor.userId) {
    throw new BadRequestError('自分自身を無効化することはできません')
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.updateMany({ where: { id, hotelId }, data: { isActive } })
    if (!isActive) {
      await tx.refreshToken.deleteMany({ where: { userId: id } })
      // 未使用の招待・リセットトークンも無効化する
      await tx.userToken.updateMany({
        where: { userId: id, usedAt: null },
        data: { usedAt: new Date() },
      })
    }
  })
  return { ...user, isActive }
}
