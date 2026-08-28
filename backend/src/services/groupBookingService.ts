import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'
import { GROUP_BOOKING_PRESETS } from '../lib/groupBookingPresets.js'
import type { CreateGroupBookingInput, UpdateGroupBookingInput } from '../lib/validators.js'

// 団体客の登録と、レベニュー影響ルールの保持（SAAS_DECISIONS.md D-09 / F-SET-05）。
// ルールはプリセット方式で保存し、施設をまたいで集計・比較できるようにする。

/** 画面の選択肢に使うプリセット一覧（システム固定・全テナント共通） */
export function listGroupBookingPresets() {
  return GROUP_BOOKING_PRESETS
}

export async function listGroupBookingsService(
  hotelId: string,
  range?: { startDate?: Date; endDate?: Date }
) {
  return prisma.groupBooking.findMany({
    where: {
      hotelId,
      // 期間が指定された場合、宿泊期間が重なるものを返す
      ...(range?.endDate && { stayStartDate: { lte: range.endDate } }),
      ...(range?.startDate && { stayEndDate: { gte: range.startDate } }),
    },
    orderBy: { stayStartDate: 'asc' },
  })
}

export async function createGroupBookingService(input: CreateGroupBookingInput) {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const { hotelId, revenueImpactRule, ...rest } = input
  return prisma.groupBooking.create({
    data: {
      ...rest,
      hotelId,
      tenantId: hotel.tenantId,
      ...(revenueImpactRule && { revenueImpactRule }),
    },
  })
}

export async function updateGroupBookingService(
  id: string,
  hotelId: string,
  input: UpdateGroupBookingInput
) {
  // hotelId 条件を含めることでテナント越え更新を防ぐ（RLSと二重の防御）
  const { revenueImpactRule, ...rest } = input
  const result = await prisma.groupBooking.updateMany({
    where: { id, hotelId },
    data: {
      ...rest,
      ...(revenueImpactRule !== undefined && { revenueImpactRule: revenueImpactRule ?? undefined }),
    },
  })
  if (result.count === 0) throw new NotFoundError('団体予約')
  return prisma.groupBooking.findUnique({ where: { id } })
}

export async function deleteGroupBookingService(id: string, hotelId: string) {
  const result = await prisma.groupBooking.deleteMany({ where: { id, hotelId } })
  if (result.count === 0) throw new NotFoundError('団体予約')
}
