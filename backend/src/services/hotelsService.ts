import type { Hotel } from '@hotel-revenue-system/shared/types'
import type { UserRole } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'

/**
 * ホテル一覧を取得。運営（PLATFORM_ADMIN）は全件、それ以外は自テナントのみ（テナント分離 — #62）。
 *
 * ADMIN はテナント管理者であり他テナントのホテルを列挙してはならないため、
 * MANAGER / OPERATOR とまったく同じテナント条件で絞り込む。
 * PLATFORM_ADMIN 以外で tenantId が無いユーザーはどのテナントにも属さないため、
 * DB に問い合わせず空リストを返す（S-1）。
 */
export async function getHotelsService(scope: {
  role: UserRole
  tenantId: string | null | undefined
}): Promise<Hotel[]> {
  const isPlatformAdmin = scope.role === 'PLATFORM_ADMIN'

  if (!isPlatformAdmin && !scope.tenantId) {
    return []
  }

  const hotels = await prisma.hotel.findMany({
    where: {
      isActive: true,
      ...(!isPlatformAdmin && { tenantId: scope.tenantId as string }),
    },
    orderBy: { name: 'asc' },
  })
  return hotels
}

/**
 * IDでホテルを取得（論理削除済みは 404）
 */
export async function getHotelByIdService(id: string): Promise<Hotel> {
  const hotel = await prisma.hotel.findFirst({
    where: { id, isActive: true },
  })

  if (!hotel) {
    throw new NotFoundError('ホテル')
  }

  return hotel
}

/**
 * アクセス制御用の軽量ルックアップ（S-5）。
 * 有効な（isActive=true の）ホテルの id / tenantId のみを返し、論理削除済み・存在しない場合は null。
 * middlewares/ からは prisma を直接 import できないため、requireHotelAccess はこの関数を使う
 */
export async function findActiveHotelService(
  id: string
): Promise<{ id: string; tenantId: string } | null> {
  return prisma.hotel.findFirst({
    where: { id, isActive: true },
    select: { id: true, tenantId: true },
  })
}

/**
 * バッチ処理用: 有効な全ホテルの最小情報を返す（N-5）。
 *
 * jobs/ からは prisma を直接 import できない規約のため、日次バッチはこの関数で
 * 対象ホテルを列挙する。ユーザーのアクセス制御を経由しないので、
 * リクエスト処理からは呼ばないこと（バッチ専用）。
 */
export async function listActiveHotelsForJobService(): Promise<
  Array<{ id: string; name: string; tenantId: string }>
> {
  return prisma.hotel.findMany({
    where: { isActive: true },
    select: { id: true, name: true, tenantId: true },
    orderBy: { createdAt: 'asc' },
  })
}

/**
 * ホテルを作成
 */
export async function createHotelService(data: {
  tenantId: string
  name: string
  address?: string
  phone?: string
  email?: string
  totalRooms: number
}): Promise<Hotel> {
  const hotel = await prisma.hotel.create({
    data,
  })
  return hotel
}

/**
 * ホテルを更新
 */
export async function updateHotelService(
  id: string,
  data: Partial<{
    name: string
    address?: string
    phone?: string
    email?: string
    totalRooms: number
    isActive: boolean
  }>
): Promise<Hotel> {
  const hotel = await prisma.hotel.update({
    where: { id },
    data,
  })
  return hotel
}

/**
 * ホテルを削除（論理削除）
 */
export async function deleteHotelService(id: string): Promise<void> {
  await prisma.hotel.update({
    where: { id },
    data: { isActive: false },
  })
}
