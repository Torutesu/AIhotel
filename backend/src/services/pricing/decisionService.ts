// 推奨の採否記録（docs/外部要因設計.md §5.1 RecommendationDecision）。
// 「適用中ランク」はここに記録された最新値。価格決定層の変動幅ガードレールと
// 期待RevPARの比較対象、採用率の算出、オーバーライド学習の材料になる。
import { prisma } from '../../lib/prisma.js'
import { BadRequestError, NotFoundError } from '../../middlewares/errorHandler.js'

export interface RecordDecisionInput {
  hotelId: string
  date: Date
  appliedRank: number
  reason?: string
}

export async function recordDecisionService(input: RecordDecisionInput, decidedByUserId: string) {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId }, select: { id: true, tenantId: true } })
  if (!hotel) throw new NotFoundError('ホテル')

  const [rank, recommendation] = await Promise.all([
    prisma.priceRank.findFirst({ where: { hotelId: input.hotelId, rank: input.appliedRank, isActive: true }, select: { rank: true } }),
    prisma.aiPriceRecommendation.findFirst({
      where: { hotelId: input.hotelId, date: input.date, roomTypeId: null },
      select: { recommendedRank: true },
    }),
  ])
  if (!rank) throw new BadRequestError(`料金ランク R${input.appliedRank} は存在しないか無効です`)
  if (!recommendation?.recommendedRank) throw new BadRequestError('この日のAI推奨がまだありません。先に需要予測を再計算してください')

  const decision = await prisma.recommendationDecision.create({
    data: {
      hotelId: input.hotelId,
      tenantId: hotel.tenantId,
      stayDate: input.date,
      recommendedRank: recommendation.recommendedRank,
      appliedRank: input.appliedRank,
      reason: input.reason ?? null,
      decidedByUserId,
    },
  })
  return decision
}

export async function listDecisionsService(hotelId: string, startDate: Date, endDate: Date) {
  return prisma.recommendationDecision.findMany({
    where: { hotelId, stayDate: { gte: startDate, lte: endDate } },
    orderBy: [{ stayDate: 'asc' }, { createdAt: 'desc' }],
  })
}
