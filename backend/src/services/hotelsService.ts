import type { Hotel } from '@hotel-revenue-system/shared/types'
import type { UserRole } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'

/**
 * ホテル一覧を取得。ADMIN は全件、それ以外は自テナントのみ（テナント分離）。
 * ADMIN 以外で tenantId が無いユーザーはどのテナントにも属さないため、
 * DB に問い合わせず空リストを返す（S-1）。
 */
export async function getHotelsService(scope: {
  role: UserRole
  tenantId: string | null | undefined
}): Promise<Hotel[]> {
  if (scope.role !== 'ADMIN' && !scope.tenantId) {
    return []
  }

  const hotels = await prisma.hotel.findMany({
    where: {
      isActive: true,
      ...(scope.role !== 'ADMIN' && { tenantId: scope.tenantId as string }),
    },
    orderBy: { name: 'asc' },
  })
  return hotels
}

/**
 * IDでホテルを取得
 */
export async function getHotelByIdService(id: string): Promise<Hotel> {
  const hotel = await prisma.hotel.findUnique({
    where: { id },
  })
  
  if (!hotel) {
    throw new NotFoundError('ホテル')
  }
  
  return hotel
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
