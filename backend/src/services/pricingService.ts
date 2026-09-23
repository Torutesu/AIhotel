import { prisma } from '../lib/prisma.js'
import { ApiError, NotFoundError } from '../middlewares/errorHandler.js'
import { eachUtcDay, monthRange, todayJst } from '../lib/date.js'
import {maxOf, median, minOf} from '../lib/stats.js'

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
        // 競合の削除は論理削除なので、isActive で絞らないと削除した競合の価格が
        // 代表値（中央値・最小・最大）に残り続ける（#90）
        competitor: { hotelId, isActive: true },
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

  const recommendationByDate = new Map(recommendations.map((r) => [r.date.toISOString().slice(0, 10), r]))

  // 暦日を軸に推奨・実績・競合を外部結合する。推奨の無い日も実績と競合価格を出す（#90）
  const calendar = eachUtcDay(start, end).map((day) => {
    const key = day.toISOString().slice(0, 10)
    const rec = recommendationByDate.get(key)
    const actual = actualByDate.get(key)
    const rank = rec?.recommendedRank != null ? rankByNumber.get(rec.recommendedRank) : undefined
    const compPrices = competitorByDate.get(key)
    return {
      date: key,
      demandLevel: rec?.demandLevel ?? null,
      recommendedRank: rec?.recommendedRank ?? null,
      recommendedPrice: rec?.recommendedPrice ?? null,
      rankLabel: rank?.label ?? null,
      price1P: rank?.price1P ?? null,
      price2P: rank?.price2P ?? null,
      price3P: rank?.price3P ?? null,
      predictedOccupancy: rec?.predictedOccupancy ?? null,
      predictedAdr: rec?.predictedAdr ?? null,
      actualOccupancy: actual?.occupancy ?? null,
      actualAdr: actual?.adr ?? null,
      // 競合料金の代表値。1社の極端な価格に引きずられない中央値を使う（C-9）
      competitorMedianPrice: median(compPrices ?? []),
      competitorMinPrice: minOf(compPrices ?? []),
      competitorMaxPrice: maxOf(compPrices ?? []),
      confidence: rec?.confidence ?? null,
      // 推奨理由（#24 E4）。推奨の無い日と、この列を足す前に作った推奨は null
      rationale: rec?.rationale ?? null,
    }
  })

  return { hotelId, year, month, calendar }
}

/**
 * 価格戦略の重み付け取得（F-DP-02）。
 *
 * まだ保存されていないホテル（新しく作ったホテルなど）は 404 にせず、需要予測が実際に使う
 * 既定値（稼働率100% — strategyWeighting.ts の OCCUPANCY_ONLY_WEIGHTS）を返す。
 * 404 だと画面がエラーになり、最初の重みを保存できなかった（#91 の作業中に判明）
 */
export async function getStrategyService(hotelId: string) {
  const config = await prisma.pricingStrategyConfig.findUnique({ where: { hotelId } })
  if (config) return config
  // 列の既定値（schema.prisma）と同じ値を返す（#17）
  return {
    id: null,
    hotelId,
    weightOccupancy: 100,
    weightAdr: 0,
    weightCompetitor: 0,
    competitorOccupancy: null,
    competitorOffsetPct: 0,
    minRank: null,
    maxRank: null,
    maxDailyRankChange: 3,
    hysteresisRanks: 1,
    updatedByUserId: null,
    updatedAt: null,
  }
}

export interface StrategyUpdate {
  weightOccupancy?: number
  weightAdr?: number
  weightCompetitor?: number
  competitorOccupancy?: 1 | 2 | null
  competitorOffsetPct?: number
  minRank?: number | null
  maxRank?: number | null
  maxDailyRankChange?: number | null
  hysteresisRanks?: number
}

/**
 * 価格戦略の更新（F-DP-02 / #17）。監査対象。
 * 送られてきた項目だけを変更する（undefined は据え置き、null は「制限なし」）。重みは3つ揃って届く（validators）。
 */
export async function updateStrategyService(hotelId: string, input: StrategyUpdate, updatedByUserId: string) {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, isActive: true } })
  if (!hotel) throw new NotFoundError('ホテル')

  const before = await prisma.pricingStrategyConfig.findUnique({ where: { hotelId } })

  const minRank = input.minRank !== undefined ? input.minRank : (before?.minRank ?? null)
  const maxRank = input.maxRank !== undefined ? input.maxRank : (before?.maxRank ?? null)
  if (minRank != null && maxRank != null && minRank > maxRank) {
    throw new ApiError(400, 'バリデーションエラー', [{ field: 'minRank', message: '推奨ランクの下限は上限以下にしてください' }])
  }

  const data = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as StrategyUpdate
  const config = await prisma.pricingStrategyConfig.upsert({
    where: { hotelId },
    update: { ...data, updatedByUserId },
    create: { hotelId, tenantId: hotel.tenantId, ...data, updatedByUserId },
  })

  return { before, after: config }
}

// ======================================
// 推奨を固定する期間（#17 のガードレール③）
// ======================================

export async function listPricingLocksService(hotelId: string) {
  return prisma.pricingLockPeriod.findMany({
    where: { hotelId, endDate: { gte: todayJst() } },
    orderBy: { startDate: 'asc' },
  })
}

export async function createPricingLockService(
  input: { hotelId: string; startDate: Date; endDate: Date; reason?: string },
  createdByUserId: string
) {
  const hotel = await prisma.hotel.findFirst({ where: { id: input.hotelId, isActive: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  return prisma.pricingLockPeriod.create({
    data: { ...input, tenantId: hotel.tenantId, createdByUserId },
  })
}

export async function deletePricingLockService(id: string, hotelId: string) {
  const existing = await prisma.pricingLockPeriod.findFirst({ where: { id, hotelId } })
  if (!existing) throw new NotFoundError('固定期間')
  const result = await prisma.pricingLockPeriod.deleteMany({ where: { id, hotelId } })
  if (result.count === 0) throw new NotFoundError('固定期間')
  return existing
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

// ======================================
// 月間着地シミュレーションの再計算（N-5 / F-DP-04）
// ======================================

/** 着地シミュレーションの実績側 1 日ぶん */
export interface ProjectionActualDay {
  soldRooms: number | null
  totalRevenue: number | null
}

/** 着地シミュレーションの予測側 1 日ぶん（AiPriceRecommendation 由来） */
export interface ProjectionPredictedDay {
  predictedOccupancy: number | null
  predictedAdr: number | null
  recommendedPrice: number | null
}

export interface LandingProjection {
  projectedRevenue: number
  projectedRooms: number
  projectedAdr: number | null
  projectedOccupancy: number
  projectedRevPar: number
  /** 内訳（UI で「実績◯日＋予測◯日」と出せるように返す） */
  actualDays: number
  predictedDays: number
}

/**
 * 実績 + AI 予測から月間着地見込みを組み立てる（N-5）。
 *
 * 実績が入っている日はその値を、まだ実績が無い日は AI 予測
 * （予測稼働率 × 客室数、予測ADR）を積み上げる。
 * 予測ADR が無い日は推奨価格を代わりに使う。forecaster は ADR 実績があれば必ず
 * predictedAdr を出すので（#77）、この代替が効くのは ADR 実績がまだ無い新規ホテルだけ。
 * どちらも無い日は積み上げない
 * （0円で積むと着地ADRが不当に下がるため、日数から除外する）。
 *
 * DB に触れない純関数にしてあり、単体テストで検証する。
 */
export function computeLandingProjection(
  actuals: ProjectionActualDay[],
  predictions: ProjectionPredictedDay[],
  totalRooms: number,
  daysInMonth: number
): LandingProjection {
  let revenue = 0
  let rooms = 0

  for (const day of actuals) {
    revenue += day.totalRevenue ?? 0
    rooms += day.soldRooms ?? 0
  }

  let predictedDays = 0
  for (const day of predictions) {
    const adr = day.predictedAdr ?? day.recommendedPrice
    if (day.predictedOccupancy == null || adr == null) continue
    const predictedRooms = Math.round(totalRooms * day.predictedOccupancy)
    revenue += predictedRooms * adr
    rooms += predictedRooms
    predictedDays += 1
  }

  const roomNights = totalRooms * daysInMonth

  return {
    projectedRevenue: Math.round(revenue),
    projectedRooms: rooms,
    projectedAdr: rooms > 0 ? Math.round(revenue / rooms) : null,
    projectedOccupancy: roomNights > 0 ? Math.round((rooms / roomNights) * 1000) / 1000 : 0,
    projectedRevPar: roomNights > 0 ? Math.round(revenue / roomNights) : 0,
    actualDays: actuals.length,
    predictedDays,
  }
}

/**
 * 月間着地シミュレーションを再計算して保存する（N-5）。
 *
 * @@unique([hotelId, year, month]) に対する upsert なので何度実行してもよい（冪等）。
 * バッチ（jobs/daily.ts）からも同じ関数を呼ぶ。
 */
export async function recomputeSimulationService(hotelId: string, year: number, month: number) {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, isActive: true } })
  if (!hotel) throw new NotFoundError('ホテル')

  const { start, end, daysInMonth } = monthRange(year, month)

  const [dailyData, recommendations] = await Promise.all([
    prisma.dailyData.findMany({
      where: { hotelId, date: { gte: start, lt: end } },
      select: { date: true, soldRooms: true, totalRevenue: true },
    }),
    prisma.aiPriceRecommendation.findMany({
      where: { hotelId, roomTypeId: null, date: { gte: start, lt: end } },
      select: { date: true, predictedOccupancy: true, predictedAdr: true, recommendedPrice: true },
    }),
  ])

  // 実績がある日は実績を優先し、AI 予測は「実績がまだ無い日」にだけ使う
  const actuals = dailyData.filter((d) => d.totalRevenue != null)
  const actualDates = new Set(actuals.map((d) => d.date.toISOString().slice(0, 10)))
  const predictions = recommendations.filter(
    (r) => !actualDates.has(r.date.toISOString().slice(0, 10))
  )

  const projection = computeLandingProjection(actuals, predictions, hotel.totalRooms, daysInMonth)

  const simulation = await prisma.monthlyLandingSimulation.upsert({
    where: { hotelId_year_month: { hotelId, year, month } },
    update: {
      projectedRevenue: projection.projectedRevenue,
      projectedRooms: projection.projectedRooms,
      projectedAdr: projection.projectedAdr,
      projectedOccupancy: projection.projectedOccupancy,
      projectedRevPar: projection.projectedRevPar,
      computedAt: new Date(),
    },
    create: {
      hotelId,
      tenantId: hotel.tenantId,
      year,
      month,
      projectedRevenue: projection.projectedRevenue,
      projectedRooms: projection.projectedRooms,
      projectedAdr: projection.projectedAdr,
      projectedOccupancy: projection.projectedOccupancy,
      projectedRevPar: projection.projectedRevPar,
    },
  })

  return { simulation, actualDays: projection.actualDays, predictedDays: projection.predictedDays }
}
