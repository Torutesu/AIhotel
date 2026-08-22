import { prisma } from '../lib/prisma.js'
import { NotFoundError, BadRequestError } from '../middlewares/errorHandler.js'
import type {
  CreatePriceRankInput,
  UpdateHotelSettingsInput,
  UpsertForecastModelConfigInput,
  CreateOutOfOrderRoomInput,
  UpdateOutOfOrderRoomInput,
} from '../lib/validators.js'

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

// ======================================
// 予測モデル設定（ホテル×年 — 「場所や年でロジックが変わる」対応）
// ======================================

/**
 * 予測モデル設定一覧（year昇順。year=0 がホテルのデフォルト設定）
 */
export async function getForecastModelConfigsService(hotelId: string) {
  return prisma.forecastModelConfig.findMany({
    where: { hotelId },
    orderBy: { year: 'asc' },
  })
}

/**
 * 予測モデル設定のアップサート（hotelId × year で一意）
 */
export async function upsertForecastModelConfigService(
  input: UpsertForecastModelConfigInput,
  updatedByUserId?: string
) {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const { hotelId, year, ...params } = input
  return prisma.forecastModelConfig.upsert({
    where: { hotelId_year: { hotelId, year } },
    update: { ...params, updatedByUserId },
    create: { hotelId, tenantId: hotel.tenantId, year, ...params, updatedByUserId },
  })
}

/**
 * 予測モデル設定の削除（削除後はデフォルト設定にフォールバックする）
 */
export async function deleteForecastModelConfigService(id: string, hotelId: string) {
  const result = await prisma.forecastModelConfig.deleteMany({ where: { id, hotelId } })
  if (result.count === 0) throw new NotFoundError('予測モデル設定')
}

// ======================================
// 故障部屋（Out of Order — 期間中は販売可能室数から差し引く）
// ======================================

/**
 * 故障部屋一覧（期間指定があれば重なるものだけ返す）
 */
export async function getOutOfOrderRoomsService(hotelId: string, startDate?: Date, endDate?: Date) {
  return prisma.outOfOrderRoom.findMany({
    where: {
      hotelId,
      isActive: true,
      ...(endDate && { startDate: { lte: endDate } }),
      ...(startDate && { endDate: { gte: startDate } }),
    },
    include: { roomType: { select: { id: true, name: true, code: true } } },
    orderBy: { startDate: 'asc' },
  })
}

/**
 * 故障部屋登録。総客室数を超える設定は拒否する
 */
export async function createOutOfOrderRoomService(input: CreateOutOfOrderRoomInput) {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')
  if (input.rooms > hotel.totalRooms) {
    throw new BadRequestError(`故障室数が総客室数（${hotel.totalRooms}室）を超えています`)
  }
  if (input.roomTypeId) {
    const roomType = await prisma.roomType.findFirst({
      where: { id: input.roomTypeId, hotelId: input.hotelId },
    })
    if (!roomType) throw new NotFoundError('部屋タイプ')
  }

  return prisma.outOfOrderRoom.create({
    data: { ...input, tenantId: hotel.tenantId },
  })
}

/**
 * 故障部屋更新
 */
export async function updateOutOfOrderRoomService(
  id: string,
  hotelId: string,
  data: UpdateOutOfOrderRoomInput
) {
  // hotelId 条件を含めることでテナント越え更新を防ぐ
  const result = await prisma.outOfOrderRoom.updateMany({
    where: { id, hotelId },
    data,
  })
  if (result.count === 0) throw new NotFoundError('故障部屋設定')
  return prisma.outOfOrderRoom.findUnique({ where: { id } })
}

/**
 * 故障部屋削除（論理削除）
 */
export async function deleteOutOfOrderRoomService(id: string, hotelId: string) {
  const result = await prisma.outOfOrderRoom.updateMany({
    where: { id, hotelId },
    data: { isActive: false },
  })
  if (result.count === 0) throw new NotFoundError('故障部屋設定')
}

/**
 * 指定期間の日別販売可能室数（totalRooms − 故障部屋）を返すヘルパー。
 * ブッキングカーブ等の稼働率計算で分母として使う。
 */
export async function getSellableRoomsByDateService(
  hotelId: string,
  startDate: Date,
  endDate: Date
): Promise<Map<string, number>> {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const oooRecords = await prisma.outOfOrderRoom.findMany({
    where: {
      hotelId,
      isActive: true,
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    },
  })

  const result = new Map<string, number>()
  for (let t = startDate.getTime(); t <= endDate.getTime(); t += 86_400_000) {
    const date = new Date(t)
    const ooo = oooRecords
      .filter((r) => date >= r.startDate && date <= r.endDate)
      .reduce((sum, r) => sum + r.rooms, 0)
    result.set(date.toISOString().slice(0, 10), Math.max(0, hotel.totalRooms - ooo))
  }
  return result
}
