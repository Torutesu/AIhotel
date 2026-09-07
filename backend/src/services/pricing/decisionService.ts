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

export interface AutoAdoptResult {
  hotelId: string
  enabled: boolean
  candidates: number
  adopted: number
}

/**
 * 自動採用モード（docs/外部要因設計.md §6 #6）。
 * 戦略設定で有効なら、リードタイムと信頼度の条件を満たし、かつ適用中ランクと異なる推奨を
 * 自動で採否記録する（decidedByUserId=null, reason='自動採用'）。同じ日に同じランクを二重記録しない
 */
export async function autoAdoptService(hotelId: string, asOfDate?: Date): Promise<AutoAdoptResult> {
  const strategy = await prisma.pricingStrategyConfig.findUnique({ where: { hotelId } })
  if (!strategy?.autoAdopt) return { hotelId, enabled: false, candidates: 0, adopted: 0 }
  const hotel = await prisma.hotel.findUniqueOrThrow({ where: { id: hotelId }, select: { tenantId: true } })

  const today = asOfDate ?? new Date()
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + strategy.autoAdoptMaxLeadDays)

  const [recs, decisions] = await Promise.all([
    prisma.aiPriceRecommendation.findMany({
      where: { hotelId, roomTypeId: null, date: { gte: start, lte: end }, recommendedRank: { not: null }, confidence: { gte: strategy.autoAdoptMinConfidence } },
      select: { date: true, recommendedRank: true },
    }),
    prisma.recommendationDecision.findMany({
      where: { hotelId, stayDate: { gte: start, lte: end } },
      orderBy: { createdAt: 'desc' },
      select: { stayDate: true, appliedRank: true },
    }),
  ])
  const applied = new Map<string, number>()
  for (const d of decisions) {
    const key = d.stayDate.toISOString().slice(0, 10)
    if (!applied.has(key)) applied.set(key, d.appliedRank)
  }

  let adopted = 0
  for (const rec of recs) {
    const key = rec.date.toISOString().slice(0, 10)
    if (applied.get(key) === rec.recommendedRank) continue
    await prisma.recommendationDecision.create({
      data: {
        hotelId,
        tenantId: hotel.tenantId,
        stayDate: rec.date,
        recommendedRank: rec.recommendedRank!,
        appliedRank: rec.recommendedRank!,
        reason: '自動採用',
        decidedByUserId: null,
      },
    })
    adopted++
  }
  return { hotelId, enabled: true, candidates: recs.length, adopted }
}
