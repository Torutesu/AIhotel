import type { Hotel } from '@hotel-revenue-system/shared/types'
import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'

/**
 * 全ホテル一覧を取得
 */
export async function getHotelsService(): Promise<Hotel[]> {
  const hotels = await prisma.hotel.findMany({
    where: { isActive: true },
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
