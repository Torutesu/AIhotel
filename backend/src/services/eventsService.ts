import { prisma } from '../lib/prisma.js'
import { NotFoundError, BadRequestError } from '../middlewares/errorHandler.js'
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
 * 更新後の開始日≦終了日を検証する（純関数）。
 * updateEventSchema は partial のため zod の refine が効かず、片方だけ更新して
 * 開始日 > 終了日 にできてしまう。既存値とマージして検証する（S-4）
 */
export function assertEventDateRange(
  existing: { startDate: Date; endDate: Date },
  patch: { startDate?: Date; endDate?: Date }
): void {
  const startDate = patch.startDate ?? existing.startDate
  const endDate = patch.endDate ?? existing.endDate
  if (startDate > endDate) {
    throw new BadRequestError('開始日は終了日以前である必要があります', [
      { field: 'startDate', message: '開始日は終了日以前である必要があります' },
    ])
  }
}

/**
 * イベント更新（hotelId 条件を含めることでテナント越え更新を防ぐ）。
 * 更新前の値も返し、呼び出し側が監査ログの oldValue に使う（S-6）
 */
export async function updateEventService(id: string, hotelId: string, data: UpdateEventInput) {
  const existing = await prisma.event.findFirst({ where: { id, hotelId } })
  if (!existing) throw new NotFoundError('イベント')

  assertEventDateRange(existing, data)

  const result = await prisma.event.updateMany({
    where: { id, hotelId },
    data,
  })
  if (result.count === 0) throw new NotFoundError('イベント')
  const updated = await prisma.event.findUnique({ where: { id } })
  return { before: existing, after: updated }
}

/**
 * イベント削除（hotelId 条件を含めることでテナント越え削除を防ぐ）。
 * 削除した行を返し、呼び出し側が監査ログの oldValue / tenantId に使う（S-6）
 */
export async function deleteEventService(id: string, hotelId: string) {
  const existing = await prisma.event.findFirst({ where: { id, hotelId } })
  if (!existing) throw new NotFoundError('イベント')

  const result = await prisma.event.deleteMany({ where: { id, hotelId } })
  if (result.count === 0) throw new NotFoundError('イベント')
  return existing
}
