import type { IntegrationKind, IntegrationStatus } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { BadRequestError, NotFoundError } from '../middlewares/errorHandler.js'

// 初期設定を速くする仕組み（#13）: 連携先の記録と、既存ホテルからの設定の複製。

// ======================================
// 連携先（PMS・サイトコントローラー）の記録
// ======================================

export async function listIntegrationsService(hotelId: string) {
  return prisma.hotelIntegration.findMany({ where: { hotelId }, orderBy: { kind: 'asc' } })
}

export async function upsertIntegrationService(
  input: {
    hotelId: string
    kind: IntegrationKind
    product: string
    connectionMethod?: string | null
    status: IntegrationStatus
    note?: string | null
  },
  updatedByUserId: string
) {
  const hotel = await prisma.hotel.findFirst({ where: { id: input.hotelId, isActive: true } })
  if (!hotel) throw new NotFoundError('ホテル')

  const before = await prisma.hotelIntegration.findUnique({
    where: { hotelId_kind: { hotelId: input.hotelId, kind: input.kind } },
  })
  const values = {
    product: input.product,
    connectionMethod: input.connectionMethod ?? null,
    status: input.status,
    note: input.note ?? null,
    updatedByUserId,
  }
  const after = await prisma.hotelIntegration.upsert({
    where: { hotelId_kind: { hotelId: input.hotelId, kind: input.kind } },
    update: values,
    create: { tenantId: hotel.tenantId, hotelId: input.hotelId, kind: input.kind, ...values },
  })
  return { before, after }
}

export async function deleteIntegrationService(hotelId: string, kind: IntegrationKind) {
  const existing = await prisma.hotelIntegration.findUnique({ where: { hotelId_kind: { hotelId, kind } } })
  if (!existing) throw new NotFoundError('連携先')
  await prisma.hotelIntegration.deleteMany({ where: { hotelId, kind } })
  return existing
}

// ======================================
// 既存ホテルからの設定の複製
// ======================================

export const COPYABLE_ITEMS = ['roomTypes', 'priceRanks', 'strategy'] as const
export type CopyableItem = (typeof COPYABLE_ITEMS)[number]

const ITEM_LABELS: Record<CopyableItem, string> = {
  roomTypes: '部屋タイプ',
  priceRanks: '料金ランク',
  strategy: '価格戦略',
}

export interface CopySettingsResult {
  tenantId: string
  copied: Partial<Record<CopyableItem, number>>
}

/**
 * 同じテナントの既存ホテルから設定を複製する（系列ホテルの追加を速くする）。
 * 複製先に既に設定がある項目は上書きせず 400 にする（誤操作で既存の設定を消さないため）。
 * 部屋タイプの室数はホテルごとに違うので複製後に調整してもらう（初期設定のチェックリストが合計の不一致を知らせる）。
 */
export async function copyHotelSettingsService(
  targetHotelId: string,
  sourceHotelId: string,
  items: CopyableItem[]
): Promise<CopySettingsResult> {
  if (targetHotelId === sourceHotelId) throw new BadRequestError('複製元と複製先が同じホテルです')

  const [target, source] = await Promise.all([
    prisma.hotel.findFirst({ where: { id: targetHotelId, isActive: true } }),
    prisma.hotel.findFirst({ where: { id: sourceHotelId, isActive: true } }),
  ])
  if (!target) throw new NotFoundError('ホテル')
  // 運営は requireHotelAccess をテナントに関係なく通るので、ここでもテナントの一致を確かめる
  if (!source || source.tenantId !== target.tenantId) throw new NotFoundError('複製元のホテル')

  const [roomTypeCount, priceRankCount, strategy] = await Promise.all([
    prisma.roomType.count({ where: { hotelId: targetHotelId, isActive: true } }),
    prisma.priceRank.count({ where: { hotelId: targetHotelId, isActive: true } }),
    prisma.pricingStrategyConfig.findUnique({ where: { hotelId: targetHotelId } }),
  ])
  const conflicts = items.filter(
    (item) =>
      (item === 'roomTypes' && roomTypeCount > 0) ||
      (item === 'priceRanks' && priceRankCount > 0) ||
      (item === 'strategy' && strategy !== null)
  )
  if (conflicts.length > 0) {
    throw new BadRequestError(
      `複製先に既に設定があるため複製できません: ${conflicts.map((c) => ITEM_LABELS[c]).join('・')}`,
      conflicts.map((c) => ({ field: 'items', message: `${ITEM_LABELS[c]}が既に登録されています` }))
    )
  }

  const tenantId = target.tenantId
  const copied: CopySettingsResult['copied'] = {}
  await prisma.$transaction(async (tx) => {
    if (items.includes('roomTypes')) {
      const rows = await tx.roomType.findMany({ where: { hotelId: sourceHotelId, isActive: true } })
      // 論理削除済みの同じコードが残っていると一意制約に当たるので、先に消しておく
      await tx.roomType.deleteMany({ where: { hotelId: targetHotelId, isActive: false } })
      await tx.roomType.createMany({
        data: rows.map((r) => ({
          tenantId,
          hotelId: targetHotelId,
          name: r.name,
          code: r.code,
          capacity: r.capacity,
          count: r.count,
          sortOrder: r.sortOrder,
        })),
      })
      copied.roomTypes = rows.length
    }
    if (items.includes('priceRanks')) {
      const rows = await tx.priceRank.findMany({ where: { hotelId: sourceHotelId, isActive: true } })
      await tx.priceRank.deleteMany({ where: { hotelId: targetHotelId, isActive: false } })
      await tx.priceRank.createMany({
        data: rows.map((r) => ({
          tenantId,
          hotelId: targetHotelId,
          rank: r.rank,
          label: r.label,
          price1P: r.price1P,
          price2P: r.price2P,
          price3P: r.price3P,
          price4P: r.price4P,
        })),
      })
      copied.priceRanks = rows.length
    }
    if (items.includes('strategy')) {
      const config = await tx.pricingStrategyConfig.findUnique({ where: { hotelId: sourceHotelId } })
      if (config) {
        const { id: _id, hotelId: _h, tenantId: _t, createdAt: _c, updatedAt: _u, updatedByUserId: _by, ...values } = config
        await tx.pricingStrategyConfig.create({ data: { ...values, tenantId, hotelId: targetHotelId } })
      }
      copied.strategy = config ? 1 : 0
    }
  })

  return { tenantId, copied }
}
