import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'
import { monthRange } from '../lib/date.js'
import { maxOf, mean, median, minOf } from '../lib/stats.js'

/**
 * 日別価格カレンダー（F-DP-01）
 * 現在価格・AI推奨ランク・需要レベル・競合平均を日別に返す
 */
export async function getPricingCalendarService(hotelId: string, year: number, month: number) {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, isActive: true } })
  if (!hotel) throw new NotFoundError('ホテル')

  const { start, end } = monthRange(year, month)

  const [recommendations, dailyData, priceRanks, competitorPrices] = await Promise.all([
    prisma.aiPriceRecommendation.findMany({
      where: { hotelId, date: { gte: start, lt: end }, roomTypeId: null },
      orderBy: { date: 'asc' },
    }),
    prisma.dailyData.findMany({
      where: { hotelId, date: { gte: start, lt: end } },
    }),
    prisma.priceRank.findMany({
      where: { hotelId, isActive: true },
      orderBy: { rank: 'asc' },
    }),
    prisma.competitorPriceData.findMany({
      where: {
        date: { gte: start, lt: end },
        competitor: { hotelId },
      },
      select: { date: true, price1P: true },
    }),
  ])

  const rankByNumber = new Map(priceRanks.map((r) => [r.rank, r]))
  const actualByDate = new Map(dailyData.map((d) => [d.date.toISOString().slice(0, 10), d]))

  // 競合平均（日別）
  const competitorByDate = new Map<string, number[]>()
  for (const cp of competitorPrices) {
    if (cp.price1P == null) continue
    const key = cp.date.toISOString().slice(0, 10)
    const list = competitorByDate.get(key) ?? []
    list.push(cp.price1P)
    competitorByDate.set(key, list)
  }

  const calendar = recommendations.map((rec) => {
    const key = rec.date.toISOString().slice(0, 10)
    const actual = actualByDate.get(key)
    const rank = rec.recommendedRank != null ? rankByNumber.get(rec.recommendedRank) : undefined
    const compPrices = competitorByDate.get(key)
    return {
      date: key,
      demandLevel: rec.demandLevel,
      recommendedRank: rec.recommendedRank,
      recommendedPrice: rec.recommendedPrice,
      rankLabel: rank?.label ?? null,
      price1P: rank?.price1P ?? null,
      price2P: rank?.price2P ?? null,
      price3P: rank?.price3P ?? null,
      predictedOccupancy: rec.predictedOccupancy,
      predictedAdr: rec.predictedAdr,
      actualOccupancy: actual?.occupancy ?? null,
      actualAdr: actual?.adr ?? null,
      // 競合料金の代表値。1社の極端な価格に引きずられない中央値を使う（C-9）
      competitorMedianPrice: median(compPrices ?? []),
      competitorMinPrice: minOf(compPrices ?? []),
      competitorMaxPrice: maxOf(compPrices ?? []),
      /**
       * @deprecated `competitorMedianPrice` を使うこと（C-9）。
       * 「平均」表現は廃止方針だが、フロントエンド（Wave B で移行）が参照しているため
       * 当面は同じ値を返し続ける。フロント移行後に削除する。
       */
      competitorAvgPrice: mean(compPrices ?? []),
      confidence: rec.confidence,
    }
  })

  return { hotelId, year, month, calendar }
}

/**
 * 価格戦略の重み付け取得（F-DP-02）
 */
export async function getStrategyService(hotelId: string) {
  const config = await prisma.pricingStrategyConfig.findUnique({ where: { hotelId } })
  if (!config) throw new NotFoundError('価格戦略設定')
  return config
}

/**
 * 価格戦略の重み付け更新（F-DP-02）。監査対象。
 */
export async function updateStrategyService(
  hotelId: string,
  weights: { weightOccupancy: number; weightAdr: number; weightCompetitor: number },
  updatedByUserId: string
) {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, isActive: true } })
  if (!hotel) throw new NotFoundError('ホテル')

  const before = await prisma.pricingStrategyConfig.findUnique({ where: { hotelId } })

  const config = await prisma.pricingStrategyConfig.upsert({
    where: { hotelId },
    update: { ...weights, updatedByUserId },
    create: {
      hotelId,
      tenantId: hotel.tenantId,
      ...weights,
      updatedByUserId,
    },
  })

  return { before, after: config }
}

/**
 * 月間着地シミュレーション（F-DP-04）
 */
export async function getSimulationService(hotelId: string, year: number, month: number) {
  const simulation = await prisma.monthlyLandingSimulation.findUnique({
    where: { hotelId_year_month: { hotelId, year, month } },
  })
  const budget = await prisma.monthlyBudget.findUnique({
    where: { hotelId_year_month: { hotelId, year, month } },
  })
  return { simulation, budget }
}
