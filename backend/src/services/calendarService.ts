import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'
import type {
  CreateSpecialDayInput,
  UpdateSpecialDayInput,
  CreateExternalFactorInput,
  UpdateExternalFactorInput,
  ExternalFactorsQueryInput,
} from '../lib/validators.js'
import { toUtcDate } from './ingestService.js'

// ======================================
// 特日マスタ・外部要因（Phase 4C — F-DP-08, F-EXT-01）
// 出典: 外部要因と旅行（宿泊）の関連付け.xlsx / モックアップ修正内容.xlsx
//
// 特日はプライシングカレンダーの曜日欄で色分け表示する（祝日=色のみ / 特日=別色）。
// AIが提示した候補（source=AI）をオペレーターが修正できる。
// ======================================

/**
 * 期間内の特日一覧（F-DP-08）
 */
export async function getSpecialDaysService(hotelId: string, startDate: Date, endDate: Date) {
  return prisma.specialDay.findMany({
    where: { hotelId, date: { gte: toUtcDate(startDate), lte: toUtcDate(endDate) } },
    orderBy: { date: 'asc' },
  })
}

export async function createSpecialDayService(input: CreateSpecialDayInput) {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  return prisma.specialDay.create({
    data: {
      tenantId: hotel.tenantId,
      hotelId: input.hotelId,
      date: toUtcDate(input.date),
      name: input.name,
      kind: input.kind,
      color: input.color ?? null,
      note: input.note ?? null,
      // 画面から登録・修正されたものはオペレーター起点として記録する
      source: 'MANUAL',
    },
  })
}

export async function updateSpecialDayService(
  id: string,
  hotelId: string,
  data: UpdateSpecialDayInput
) {
  const result = await prisma.specialDay.updateMany({
    where: { id, hotelId },
    // AI提示分をオペレーターが直した時点で MANUAL に切り替える
    data: { ...data, source: 'MANUAL' },
  })
  if (result.count === 0) throw new NotFoundError('特日')
  return prisma.specialDay.findUnique({ where: { id } })
}

export async function deleteSpecialDayService(id: string, hotelId: string) {
  const result = await prisma.specialDay.deleteMany({ where: { id, hotelId } })
  if (result.count === 0) throw new NotFoundError('特日')
}

/**
 * 期間に重なる外部要因一覧（F-EXT-01）
 */
export async function getExternalFactorsService(input: ExternalFactorsQueryInput) {
  const start = toUtcDate(input.startDate)
  const end = toUtcDate(input.endDate)
  return prisma.externalFactor.findMany({
    where: {
      hotelId: input.hotelId,
      ...(input.category && { category: input.category }),
      // 期間が少しでも重なるものを拾う
      startDate: { lte: end },
      endDate: { gte: start },
    },
    orderBy: [{ startDate: 'asc' }, { category: 'asc' }],
  })
}

export async function createExternalFactorService(input: CreateExternalFactorInput) {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  return prisma.externalFactor.create({
    data: {
      tenantId: hotel.tenantId,
      hotelId: input.hotelId,
      category: input.category,
      timeAxis: input.timeAxis,
      title: input.title,
      description: input.description ?? null,
      startDate: toUtcDate(input.startDate),
      endDate: toUtcDate(input.endDate),
      impactScore: input.impactScore ?? null,
      area: input.area ?? null,
      sourceUrl: input.sourceUrl ?? null,
      source: 'MANUAL',
    },
  })
}

export async function updateExternalFactorService(
  id: string,
  hotelId: string,
  data: UpdateExternalFactorInput
) {
  const result = await prisma.externalFactor.updateMany({
    where: { id, hotelId },
    data: { ...data, source: 'MANUAL' },
  })
  if (result.count === 0) throw new NotFoundError('外部要因')
  return prisma.externalFactor.findUnique({ where: { id } })
}

export async function deleteExternalFactorService(id: string, hotelId: string) {
  const result = await prisma.externalFactor.deleteMany({ where: { id, hotelId } })
  if (result.count === 0) throw new NotFoundError('外部要因')
}
