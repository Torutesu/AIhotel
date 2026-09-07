import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'
import type { CreateEventInput, UpdateEventInput } from '../lib/validators.js'
import { estimateEventImpact } from './events/eventImpact.js'

/**
 * イベント一覧（F-DP-07）。期間は任意 — 指定期間と重なるイベントを返す
 */
export async function getEventsService(
  hotelId: string,
  startDate?: Date,
  endDate?: Date,
  status: 'confirmed' | 'candidate' | 'rejected' | 'all' = 'confirmed'
) {
  return prisma.event.findMany({
    where: {
      hotelId,
      ...(status !== 'all' && { status }),
      ...(startDate && { endDate: { gte: startDate } }),
      ...(endDate && { startDate: { lte: endDate } }),
    },
    orderBy: { startDate: 'asc' },
    include: { venue: { select: { id: true, name: true } } },
  })
}

/**
 * イベント登録（オペレーターも登録可 — F-DP-07）
 */
export async function createEventService(input: CreateEventInput, createdByUserId: string) {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  // 会場が指定され影響度が未入力なら、収容人数・距離・来場者数から初期値を推定する
  let expectedImpact = input.expectedImpact
  if (!expectedImpact && input.venueId) {
    const venue = await prisma.venue.findFirst({ where: { id: input.venueId, hotelId: input.hotelId } })
    if (!venue) throw new NotFoundError('会場')
    expectedImpact =
      estimateEventImpact({ capacity: venue.capacity, distanceKm: venue.distanceKm, totalRooms: hotel.totalRooms, expectedAttendance: input.expectedAttendance }) ??
      undefined
  }

  return prisma.event.create({
    data: { ...input, expectedImpact, tenantId: hotel.tenantId, createdByUserId },
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
