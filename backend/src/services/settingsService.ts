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
  const hotel = await prisma.hotel.findFirst({ where: { id: input.hotelId, isActive: true } })
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
  // hotelId 条件を含めることでテナント越えの参照・更新を防ぐ
  // 監査ログの oldValue 用に更新前の行を取得しておく（S-6）
  const before = await prisma.priceRank.findFirst({ where: { id, hotelId } })
  if (!before) throw new NotFoundError('料金ランク')

  const result = await prisma.priceRank.updateMany({
    where: { id, hotelId },
    data,
  })
  if (result.count === 0) throw new NotFoundError('料金ランク')

  const after = await prisma.priceRank.findUnique({ where: { id } })
  if (!after) throw new NotFoundError('料金ランク')
  return { before, after }
}

/**
 * 料金ランク削除（論理削除）
 *
 * 監査ログに tenantId と oldValue を残すため、削除前の行を返す（S-6）。
 */
export async function deletePriceRankService(id: string, hotelId: string) {
  const before = await prisma.priceRank.findFirst({ where: { id, hotelId } })
  if (!before) throw new NotFoundError('料金ランク')

  const result = await prisma.priceRank.updateMany({
    where: { id, hotelId },
    data: { isActive: false },
  })
  if (result.count === 0) throw new NotFoundError('料金ランク')

  return before
}

/**
 * ホテル設定更新（名称・住所・連絡先・部屋数・週末定義 — F-SET-01）
 */
export async function updateHotelSettingsService(id: string, data: UpdateHotelSettingsInput) {
  const before = await prisma.hotel.findFirst({ where: { id, isActive: true } })
  if (!before) throw new NotFoundError('ホテル')

  const after = await prisma.hotel.update({
    where: { id },
    data,
  })

  return { before, after }
}
