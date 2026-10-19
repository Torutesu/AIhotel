import { prisma } from '../lib/prisma.js'
import { NotFoundError, BadRequestError } from '../middlewares/errorHandler.js'
import type { CreateEventInput, ImportEventsInput, UpdateEventInput } from '../lib/validators.js'

/** 期間を指定しないときに返す最大件数（#90）。期間を指定すれば 366 日以内で全件 */
export const MAX_EVENTS_WITHOUT_RANGE = 500

/**
 * イベント一覧（F-DP-07）。期間は任意 — 指定期間と重なるイベントを返す。
 * 期間を省略したときは件数に上限を設ける（全件を1リクエストで返させない — #90）
 */
export async function getEventsService(hotelId: string, startDate?: Date, endDate?: Date) {
  const unbounded = !startDate && !endDate
  return prisma.event.findMany({
    where: {
      hotelId,
      ...(startDate && { endDate: { gte: startDate } }),
      ...(endDate && { startDate: { lte: endDate } }),
    },
    orderBy: { startDate: 'asc' },
    ...(unbounded && { take: MAX_EVENTS_WITHOUT_RANGE }),
  })
}

/**
 * イベント登録（オペレーターも登録可 — F-DP-07）
 */
export async function createEventService(input: CreateEventInput, createdByUserId: string) {
  const hotel = await prisma.hotel.findFirst({ where: { id: input.hotelId, isActive: true } })
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

// ======================================
// イベントの取り込み（外部需要動向の規定フォーム — 2026-10）
// ======================================

/** 取り込む行の検証（純関数）: 開始日 ≦ 終了日、ファイル内で同じ名前・同じ開始日の行が重なっていないか */
export function findEventImportRowErrors(rows: ImportEventsInput['rows']): Array<{ field: string; message: string }> {
  const errors: Array<{ field: string; message: string }> = []
  const seen = new Map<string, number>()
  rows.forEach((row, index) => {
    if (row.startDate > row.endDate) {
      errors.push({ field: `rows.${index}.endDate`, message: `終了日 ${row.endDate} が開始日 ${row.startDate} より前です` })
    }
    const key = `${row.name}\u0000${row.startDate}`
    const first = seen.get(key)
    if (first !== undefined) {
      errors.push({ field: `rows.${index}.name`, message: `「${row.name}」（${row.startDate}〜）が ${first + 2} 行目と重複しています` })
    } else {
      seen.set(key, index)
    }
  })
  return errors
}

export interface ImportEventsResult {
  dryRun: boolean
  total: number
  created: number
  updated: number
  startDate: string
  endDate: string
  tenantId: string
}

/**
 * イベントをまとめて登録する。同じホテル・同じ名前・同じ開始日のイベントは上書きする（何度取り込んでも増えない）。
 * 全行を検証してから1トランザクションで書く（1行でも不正なら何も書かない — #82 と同じ方針）
 */
export async function importEventsService(input: ImportEventsInput, userId: string): Promise<ImportEventsResult> {
  const hotel = await prisma.hotel.findFirst({ where: { id: input.hotelId, isActive: true }, select: { id: true, tenantId: true } })
  if (!hotel) throw new NotFoundError('ホテル')

  const errors = findEventImportRowErrors(input.rows)
  if (errors.length > 0) throw new BadRequestError('取り込めない行があります。1行も取り込んでいません', errors)

  const toDate = (v: string) => new Date(`${v}T00:00:00Z`)
  const existing = await prisma.event.findMany({
    where: { hotelId: hotel.id, OR: input.rows.map((r) => ({ name: r.name, startDate: toDate(r.startDate) })) },
    select: { id: true, name: true, startDate: true },
  })
  const existingByKey = new Map(existing.map((e) => [`${e.name}\u0000${e.startDate.toISOString().slice(0, 10)}`, e.id]))
  const starts = input.rows.map((r) => r.startDate).sort()
  const ends = input.rows.map((r) => r.endDate).sort()
  const updated = input.rows.filter((r) => existingByKey.has(`${r.name}\u0000${r.startDate}`)).length

  const summary: ImportEventsResult = {
    dryRun: Boolean(input.dryRun),
    total: input.rows.length,
    created: input.rows.length - updated,
    updated,
    startDate: starts[0],
    endDate: ends[ends.length - 1],
    tenantId: hotel.tenantId,
  }
  if (input.dryRun) return summary

  await prisma.$transaction(
    async (tx) => {
      for (const row of input.rows) {
        const data = {
          name: row.name,
          type: row.type,
          startDate: toDate(row.startDate),
          endDate: toDate(row.endDate),
          location: row.location ?? null,
          expectedImpact: row.expectedImpact ?? null,
          description: row.description ?? null,
          excludeFromHistory: row.excludeFromHistory ?? false,
        }
        const id = existingByKey.get(`${row.name}\u0000${row.startDate}`)
        if (id) {
          await tx.event.updateMany({ where: { id, hotelId: hotel.id }, data })
        } else {
          await tx.event.create({ data: { ...data, hotelId: hotel.id, tenantId: hotel.tenantId, createdByUserId: userId } })
        }
      }
    },
    { timeout: 60_000 }
  )
  return summary
}
