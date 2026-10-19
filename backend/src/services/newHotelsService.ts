import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { BadRequestError, ConflictError, NotFoundError } from '../middlewares/errorHandler.js'
import type { CreateNewHotelInput, ImportNewHotelsInput, UpdateNewHotelInput } from '../lib/validators.js'

// 周辺の新規ホテル（開業予定・開業済み — 外部需要動向 2026-10）。
// 供給が増える時期を需要の見通しに入れるための記録。手入力と規定フォーム（CSV）の取り込みで登録する。
// どのクエリも hotelId で絞る（hotelId は requireHotelAccess でテナントを確かめ済み）。

/** 一覧（開業日の昇順） */
export async function listNewHotelsService(hotelId: string) {
  return prisma.newHotelOpening.findMany({ where: { hotelId }, orderBy: [{ openingDate: 'asc' }, { name: 'asc' }] })
}

const DUPLICATE_MESSAGE = '同じ名前・同じ開業日の新規ホテルが既に登録されています'

/** 一意制約（ホテル・名前・開業日）の違反を 409 にする */
async function withDuplicateCheck<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new ConflictError(DUPLICATE_MESSAGE)
    throw err
  }
}

export async function createNewHotelService(input: CreateNewHotelInput, createdByUserId: string) {
  const hotel = await prisma.hotel.findFirst({ where: { id: input.hotelId, isActive: true }, select: { tenantId: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  return withDuplicateCheck(() => prisma.newHotelOpening.create({ data: { ...input, tenantId: hotel.tenantId, createdByUserId } }))
}

/** 更新。更新前の値も返し、呼び出し側が監査ログの oldValue に使う */
export async function updateNewHotelService(id: string, hotelId: string, data: UpdateNewHotelInput) {
  const before = await prisma.newHotelOpening.findFirst({ where: { id, hotelId } })
  if (!before) throw new NotFoundError('新規ホテル')
  const result = await withDuplicateCheck(() => prisma.newHotelOpening.updateMany({ where: { id, hotelId }, data }))
  if (result.count === 0) throw new NotFoundError('新規ホテル')
  const after = await prisma.newHotelOpening.findUnique({ where: { id } })
  return { before, after }
}

export async function deleteNewHotelService(id: string, hotelId: string) {
  const existing = await prisma.newHotelOpening.findFirst({ where: { id, hotelId } })
  if (!existing) throw new NotFoundError('新規ホテル')
  const result = await prisma.newHotelOpening.deleteMany({ where: { id, hotelId } })
  if (result.count === 0) throw new NotFoundError('新規ホテル')
  return existing
}

const keyOf = (name: string, openingDate: string) => `${name}\u0000${openingDate}`

/** 取り込む行の検証（純関数）: ファイル内で同じ名前・同じ開業日の行が重なっていないか */
export function findNewHotelImportRowErrors(rows: ImportNewHotelsInput['rows']): Array<{ field: string; message: string }> {
  const errors: Array<{ field: string; message: string }> = []
  const seen = new Map<string, number>()
  rows.forEach((row, index) => {
    const key = keyOf(row.name, row.openingDate)
    const first = seen.get(key)
    if (first !== undefined) {
      errors.push({ field: `rows.${index}.name`, message: `「${row.name}」（開業 ${row.openingDate}）が ${first + 2} 行目と重複しています` })
    } else {
      seen.set(key, index)
    }
  })
  return errors
}

export interface ImportNewHotelsResult {
  dryRun: boolean
  total: number
  created: number
  updated: number
  startDate: string
  endDate: string
  tenantId: string
}

/**
 * まとめて登録する。同じホテル・同じ名前・同じ開業日の行は上書きする（何度取り込んでも増えない）。
 * 全行を検証してから1トランザクションで書く。書き込みは一意制約のキーで upsert するので、同時に取り込んでも重複しない
 */
export async function importNewHotelsService(input: ImportNewHotelsInput, userId: string): Promise<ImportNewHotelsResult> {
  const hotel = await prisma.hotel.findFirst({ where: { id: input.hotelId, isActive: true }, select: { id: true, tenantId: true } })
  if (!hotel) throw new NotFoundError('ホテル')

  const errors = findNewHotelImportRowErrors(input.rows)
  if (errors.length > 0) throw new BadRequestError('取り込めない行があります。1行も取り込んでいません', errors)

  const toDate = (v: string) => new Date(`${v}T00:00:00Z`)
  const existing = await prisma.newHotelOpening.findMany({
    where: { hotelId: hotel.id, OR: input.rows.map((r) => ({ name: r.name, openingDate: toDate(r.openingDate) })) },
    select: { id: true, name: true, openingDate: true },
  })
  const existingByKey = new Map(existing.map((e) => [keyOf(e.name, e.openingDate.toISOString().slice(0, 10)), e.id]))
  const dates = input.rows.map((r) => r.openingDate).sort()
  const updated = input.rows.filter((r) => existingByKey.has(keyOf(r.name, r.openingDate))).length

  const summary: ImportNewHotelsResult = {
    dryRun: Boolean(input.dryRun),
    total: input.rows.length,
    created: input.rows.length - updated,
    updated,
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    tenantId: hotel.tenantId,
  }
  if (input.dryRun) return summary

  await prisma.$transaction(
    async (tx) => {
      for (const row of input.rows) {
        const openingDate = toDate(row.openingDate)
        const fields = {
          rooms: row.rooms ?? null,
          category: row.category ?? null,
          location: row.location ?? null,
          distanceKm: row.distanceKm ?? null,
          expectedImpact: row.expectedImpact ?? null,
          notes: row.notes ?? null,
        }
        await tx.newHotelOpening.upsert({
          where: { hotelId_name_openingDate: { hotelId: hotel.id, name: row.name, openingDate } },
          update: fields,
          create: { ...fields, name: row.name, openingDate, hotelId: hotel.id, tenantId: hotel.tenantId, createdByUserId: userId },
        })
      }
    },
    { timeout: 60_000 }
  )
  return summary
}
