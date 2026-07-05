import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'
import type { CreateEventInput, UpdateEventInput } from '../lib/validators.js'

/**
 * イベント一覧（F-DP-07）。期間は任意 — 指定期間と重なるイベントを返す
 */
export async function getEventsService(hotelId: string, startDate?: Date, endDate?: Date) {
  return prisma.event.findMany({
    where: {
      hotelId,
      ...(startDate && { endDate: { gte: startDate } }),
      ...(endDate && { startDate: { lte: endDate } }),
    },
    orderBy: { startDate: 'asc' },
  })
}

/**
 * イベント登録（オペレーターも登録可 — F-DP-07）
 */
export async function createEventService(input: CreateEventInput, createdByUserId: string) {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  return prisma.event.create({
    data: { ...input, tenantId: hotel.tenantId, createdByUserId },
  })
}

/**
 * イベント更新（hotelId 条件を含めることでテナント越え更新を防ぐ）
 */
export async function updateEventService(id: string, hotelId: string, data: UpdateEventInput) {
  const result = await prisma.event.updateMany({
    where: { id, hotelId },
    data,
  })
  if (result.count === 0) throw new NotFoundError('イベント')
  return prisma.event.findUnique({ where: { id } })
}

/**
 * イベント削除（hotelId 条件を含めることでテナント越え削除を防ぐ）
 */
export async function deleteEventService(id: string, hotelId: string) {
  const result = await prisma.event.deleteMany({ where: { id, hotelId } })
  if (result.count === 0) throw new NotFoundError('イベント')
}
