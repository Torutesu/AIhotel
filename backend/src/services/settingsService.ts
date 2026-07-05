import { prisma } from '../lib/prisma.js'
import { NotFoundError, BadRequestError } from '../middlewares/errorHandler.js'
import type { CreatePriceRankInput, UpdateHotelSettingsInput } from '../lib/validators.js'

const MAX_PRICE_RANKS = 40 // F-SET-02

/**
 * 料金ランク一覧（F-SET-02）
 */
export async function getPriceRanksService(hotelId: string) {
  return prisma.priceRank.findMany({
    where: { hotelId, isActive: true },
    orderBy: { rank: 'asc' },
  })
}

/**
 * 料金ランク作成
 */
export async function createPriceRankService(input: CreatePriceRankInput) {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const count = await prisma.priceRank.count({
    where: { hotelId: input.hotelId, isActive: true },
  })
  if (count >= MAX_PRICE_RANKS) {
    throw new BadRequestError(`料金ランクは最大${MAX_PRICE_RANKS}段階までです`)
  }

  return prisma.priceRank.create({
    data: { ...input, tenantId: hotel.tenantId },
  })
}

/**
 * 料金ランク更新
 */
export async function updatePriceRankService(
  id: string,
  hotelId: string,
  data: Partial<Omit<CreatePriceRankInput, 'hotelId' | 'rank'>>
) {
  // hotelId 条件を含めることでテナント越え更新を防ぐ
  const result = await prisma.priceRank.updateMany({
    where: { id, hotelId },
    data,
  })
  if (result.count === 0) throw new NotFoundError('料金ランク')
  return prisma.priceRank.findUnique({ where: { id } })
}

/**
 * 料金ランク削除（論理削除）
 */
export async function deletePriceRankService(id: string, hotelId: string) {
  const result = await prisma.priceRank.updateMany({
    where: { id, hotelId },
    data: { isActive: false },
  })
  if (result.count === 0) throw new NotFoundError('料金ランク')
}

/**
 * ホテル設定更新（名称・住所・連絡先・部屋数・週末定義 — F-SET-01）
 */
export async function updateHotelSettingsService(id: string, data: UpdateHotelSettingsInput) {
  const hotel = await prisma.hotel.findUnique({ where: { id } })
  if (!hotel) throw new NotFoundError('ホテル')

  return prisma.hotel.update({
    where: { id },
    data,
  })
}
