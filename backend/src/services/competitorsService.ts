import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'
import type { CreateCompetitorInput, UpdateCompetitorInput } from '../lib/validators.js'

// 競合ホテルの登録（F-SET-03）。DBの受け皿はあったが投入手段がなく、
// 競合分析が動かない状態だったため追加する。

export async function listCompetitorsService(hotelId: string, includeInactive = false) {
  return prisma.competitor.findMany({
    where: { hotelId, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: { createdAt: 'asc' },
  })
}

export async function createCompetitorService(input: CreateCompetitorInput) {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const { otaUrls, ...rest } = input
  return prisma.competitor.create({
    data: { ...rest, tenantId: hotel.tenantId, ...(otaUrls && { otaUrls }) },
  })
}

export async function updateCompetitorService(
  id: string,
  hotelId: string,
  input: UpdateCompetitorInput
) {
  const { otaUrls, ...rest } = input
  const result = await prisma.competitor.updateMany({
    where: { id, hotelId },
    data: { ...rest, ...(otaUrls !== undefined && { otaUrls }) },
  })
  if (result.count === 0) throw new NotFoundError('競合ホテル')
  return prisma.competitor.findUnique({ where: { id } })
}

/** 論理削除。過去の競合価格データが参照するため物理削除はしない */
export async function deactivateCompetitorService(id: string, hotelId: string) {
  const result = await prisma.competitor.updateMany({
    where: { id, hotelId },
    data: { isActive: false },
  })
  if (result.count === 0) throw new NotFoundError('競合ホテル')
}
