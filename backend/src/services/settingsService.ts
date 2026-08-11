import { Prisma, type SegmentKind, type RateCategory } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'
import type {
  CreatePriceRankInput,
  UpdatePriceRankInput,
  BulkUpsertPriceRanksInput,
  UpdateHotelSettingsInput,
  UpsertSegmentsInput,
} from '../lib/validators.js'

/**
 * 料金ランク一覧（F-SET-02）
 * 部屋タイプ／レート区分で絞り込み可能。並びは sortOrder 降順（高価格側＝ランク番号が小さい側が先頭）。
 */
export async function getPriceRanksService(filter: {
  hotelId: string
  roomTypeId?: string
  rateCategory?: RateCategory
}) {
  return prisma.priceRank.findMany({
    where: {
      hotelId: filter.hotelId,
      isActive: true,
      ...(filter.roomTypeId && { roomTypeId: filter.roomTypeId }),
      ...(filter.rateCategory && { rateCategory: filter.rateCategory }),
    },
    // 部屋タイプはマスタ順、ランクは高価格側（sortOrder降順）から並べる
    orderBy: [{ roomType: { sortOrder: 'asc' } }, { rateCategory: 'asc' }, { sortOrder: 'desc' }],
  })
}

/**
 * 料金ランク作成
 */
export async function createPriceRankService(input: CreatePriceRankInput) {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  // 部屋タイプが同一ホテルに属することを確認（テナント越え参照の防止）
  const roomType = await prisma.roomType.findFirst({
    where: { id: input.roomTypeId, hotelId: input.hotelId },
  })
  if (!roomType) throw new NotFoundError('部屋タイプ')

  return prisma.priceRank.create({
    data: { ...input, tenantId: hotel.tenantId },
  })
}

/**
 * 料金ランク更新（価格・並び順・有効フラグ）
 */
export async function updatePriceRankService(
  id: string,
  hotelId: string,
  data: UpdatePriceRankInput
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
 * 料金表の一括登録（販売料金表の取込・編集 — F-SET-02）
 * 部屋タイプ×レート区分の1系列をまとめて upsert する。
 */
export async function bulkUpsertPriceRanksService(input: BulkUpsertPriceRanksInput) {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const roomType = await prisma.roomType.findFirst({
    where: { id: input.roomTypeId, hotelId: input.hotelId },
  })
  if (!roomType) throw new NotFoundError('部屋タイプ')

  const results = await prisma.$transaction(
    input.items.map((item) =>
      prisma.priceRank.upsert({
        where: {
          hotelId_roomTypeId_rateCategory_rankCode: {
            hotelId: input.hotelId,
            roomTypeId: input.roomTypeId,
            rateCategory: input.rateCategory,
            rankCode: item.rankCode,
          },
        },
        create: {
          tenantId: hotel.tenantId,
          hotelId: input.hotelId,
          roomTypeId: input.roomTypeId,
          rateCategory: input.rateCategory,
          rankCode: item.rankCode,
          sortOrder: item.sortOrder,
          price: item.price,
          isActive: item.isActive ?? true,
        },
        update: {
          sortOrder: item.sortOrder,
          price: item.price,
          isActive: item.isActive ?? true,
        },
      })
    )
  )

  return {
    upserted: results.length,
    roomTypeId: input.roomTypeId,
    rateCategory: input.rateCategory,
    tenantId: hotel.tenantId,
  }
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
// セグメントマスタ（F-SET-06 — Phase 4A）
// ======================================

/**
 * セグメントマスタ一覧（kind省略時は全種別）
 */
export async function getSegmentsService(hotelId: string, kind?: SegmentKind) {
  return prisma.segmentMaster.findMany({
    where: { hotelId, ...(kind && { kind }) },
    orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { code: 'asc' }],
  })
}

/**
 * セグメントマスタ一括upsert（kind単位）。
 * マスタ設定.xlsx / PMSコードマスターからの取込・ツール上での編集の両方に使う。
 */
export async function upsertSegmentsService(input: UpsertSegmentsInput) {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const results = await prisma.$transaction(
    input.items.map((item, index) =>
      prisma.segmentMaster.upsert({
        where: {
          hotelId_kind_code: { hotelId: input.hotelId, kind: input.kind, code: item.code },
        },
        create: {
          tenantId: hotel.tenantId,
          hotelId: input.hotelId,
          kind: input.kind,
          code: item.code,
          name: item.name,
          aggregateCode: item.aggregateCode ?? null,
          attributes: (item.attributes as Prisma.InputJsonValue | undefined) ?? undefined,
          sortOrder: item.sortOrder ?? index,
          isActive: item.isActive ?? true,
        },
        update: {
          name: item.name,
          aggregateCode: item.aggregateCode ?? null,
          attributes: (item.attributes as Prisma.InputJsonValue | undefined) ?? undefined,
          sortOrder: item.sortOrder ?? index,
          isActive: item.isActive ?? true,
        },
      })
    )
  )
  return { upserted: results.length, kind: input.kind, tenantId: hotel.tenantId }
}
