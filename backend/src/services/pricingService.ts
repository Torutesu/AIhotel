import { prisma } from '../lib/prisma.js'
import { ApiError, NotFoundError } from '../middlewares/errorHandler.js'
import { addUtcDays, monthRange, todayJst } from '../lib/date.js'
import {maxOf, median, minOf} from '../lib/stats.js'
import { loadMonthContext } from './dayContextService.js'
import { buildDayTypeTimeline } from './forecast/dayType.js'
import { leadDaysBetween, otbAtLead } from './forecast/pace.js'
import { loadDayTypeModel } from './dayTypeService.js'

/** タイプ別の AI 想定値に使う、過去の販売構成を見る日数 */
export const ROOM_TYPE_MIX_DAYS = 90

/** タイプ別に見るときの配分の比（過去 ROOM_TYPE_MIX_DAYS 日のタイプ別の販売構成・単価） */
export interface RoomTypeMix {
  /** 全タイプの販売室数に占めるこのタイプの割合 */
  roomShare: number
  /** このタイプの ADR ÷ 全タイプの ADR */
  adrRatio: number
}

/**
 * タイプ別の販売実績の合計から配分の比を出す（純関数）。
 * 実績が無いホテル（取り込み前など）は客室数の比・単価は同じとみなす（fallbackShare）
 */
export function roomTypeMixFrom(
  totals: Array<{ roomTypeId: string; soldRooms: number; revenue: number }>,
  roomTypeId: string,
  fallbackShare: number
): RoomTypeMix {
  const allSold = totals.reduce((a, t) => a + t.soldRooms, 0)
  const allRevenue = totals.reduce((a, t) => a + t.revenue, 0)
  if (allSold <= 0) return { roomShare: fallbackShare, adrRatio: 1 }
  const type = totals.find((t) => t.roomTypeId === roomTypeId)
  const typeSold = type?.soldRooms ?? 0
  const typeRevenue = type?.revenue ?? 0
  const allAdr = allRevenue / allSold
  return {
    roomShare: typeSold / allSold,
    adrRatio: typeSold > 0 && allAdr > 0 ? typeRevenue / typeSold / allAdr : 1,
  }
}

const round3 = (v: number) => Math.round(v * 1000) / 1000

/** タイプ別に置き換える値（予算は持たないので null） */
interface RoomTypeDayValues {
  budgetRooms: null
  budgetOccupancy: null
  budgetAdr: null
  budgetRevenue: null
  actualOccupancy: number | null
  actualAdr: number | null
  onHandRooms: number | null
  currentOccupancy: number | null
  onHandAdr: number | null
  currentRevenue: number | null
  predictedOccupancy: number | null
  predictedAdr: number | null
  expectedRevenue: number | null
}

/**
 * ALL（全タイプの合計）の1日を、1つの部屋タイプの数値に直す（純関数 — 2026-10-24 の画面修正）。
 * - 予算: タイプ別には持たない（導入時のヒアリングによる）ので null（画面は「-」）
 * - 現在（結果・予約）: 結果の出た日はタイプ別の実績（DailyRoomData）。先の日のタイプ別の予約室数は
 *   PMS／サイトコントローラー連携まで無いので null
 * - AI の想定値: ホテル全体の予測を、過去のタイプ別の販売構成（室数の比）と単価の比で配る。
 *   部屋売り（人数で価格が変わらない）を前提にした配り方。人数売りの施設は DOR と客単価で出す（導入時に対応）
 * - 料金ランク・需要のアラート・日のタイプ・競合はタイプ共通（日の性質・全タイプ共通のランクの段階）
 */
export function toRoomTypeDay<
  T extends {
    predictedOccupancy: number | null
    predictedAdr: number | null
    recommendedPrice: number | null
  },
>(
  day: T,
  ctx: {
    /** このタイプの室数 */
    count: number
    /** ホテルの客室数（AI の予測稼働率から室数を出す） */
    hotelRooms: number
    mix: RoomTypeMix
    /** その日のタイプ別の実績。無ければ null */
    actual: { soldRooms: number | null; revenue: number | null } | null
  }
): Omit<T, keyof RoomTypeDayValues> & RoomTypeDayValues {
  const { count, hotelRooms, mix, actual } = ctx
  const sold = actual?.soldRooms ?? null
  const actualOccupancy = sold != null && count > 0 ? round3(sold / count) : null
  const actualAdr = sold != null && sold > 0 && actual?.revenue != null ? Math.round(actual.revenue / sold) : null

  const predictedRooms = day.predictedOccupancy != null ? Math.round(day.predictedOccupancy * hotelRooms * mix.roomShare) : null
  const predictedOccupancy = predictedRooms != null && count > 0 ? Math.min(1, round3(predictedRooms / count)) : null
  const predictedAdr = day.predictedAdr != null ? Math.round(day.predictedAdr * mix.adrRatio) : null
  const expectedAdrBase = day.predictedAdr ?? day.recommendedPrice
  const expectedRevenue =
    predictedRooms != null && expectedAdrBase != null ? Math.round(predictedRooms * expectedAdrBase * mix.adrRatio) : null

  const values: RoomTypeDayValues = {
    budgetRooms: null,
    budgetOccupancy: null,
    budgetAdr: null,
    budgetRevenue: null,
    actualOccupancy,
    actualAdr,
    onHandRooms: sold,
    currentOccupancy: actualOccupancy,
    onHandAdr: actualAdr,
    currentRevenue: sold != null ? (actual?.revenue ?? null) : null,
    predictedOccupancy,
    predictedAdr,
    expectedRevenue,
  }
  return { ...day, ...values }
}

/**
 * 日別価格カレンダー（F-DP-01）
 * 現在価格・AI推奨ランク・需要レベル・競合平均を日別に返す。
 * 2026-10 の画面修正（DP02 / DP03 / DP04）で、オペレーターが価格を決める材料として
 * 日割り予算・オンハンド（今の予約室数）・想定売上・日のタイプ（日のモデル）とその推移を足した。
 * roomTypeId を渡すと、そのタイプの数値に直して返す（2026-10-24 — toRoomTypeDay）
 */
export async function getPricingCalendarService(hotelId: string, year: number, month: number, roomTypeId?: string) {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, isActive: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  // タイプは指定したホテルのものに限る（他ホテル・他テナントのタイプ ID は存在しない扱い）
  const roomType = roomTypeId
    ? await prisma.roomType.findFirst({ where: { id: roomTypeId, hotelId, isActive: true } })
    : null
  if (roomTypeId && !roomType) throw new NotFoundError('部屋タイプ')

  const { start, end } = monthRange(year, month)

  const today = todayJst()
  const [recommendations, dailyData, priceRanks, competitorPrices, context, dayTypeModel] = await Promise.all([
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
    // 前年同曜日の予約積上はカレンダーでは使わない（日のタイプは型の典型カーブで判定する）
    loadMonthContext(hotelId, hotel.totalRooms, year, month, { lastYearCurves: false }),
    loadDayTypeModel(hotelId, today),
  ])

  const totalRooms = hotel.totalRooms
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
  const calendar = context.days.map((day, index) => {
    const key = day.toISOString().slice(0, 10)
    const rec = recommendationByDate.get(key)
    const actual = actualByDate.get(key)
    const rank = rec?.recommendedRank != null ? rankByNumber.get(rec.recommendedRank) : undefined
    const compPrices = competitorByDate.get(key)
    const budget = context.budgets[index]
    const points = context.curves.get(day.getTime()) ?? []

    // オンハンド: 結果が出た日は販売室数、先の日は今の予約室数（直近3日以内の予約積上）
    const lead = leadDaysBetween(today, day)
    const onHandRooms = actual?.soldRooms ?? (lead >= 0 ? otbAtLead(points, lead) : null)
    const currentOccupancy =
      actual?.occupancy ?? (onHandRooms != null && totalRooms > 0 ? Math.round((onHandRooms / totalRooms) * 1000) / 1000 : null)

    // 想定売上: AI の予測稼働率 × 客室数 × 予測ADR（無ければ推奨価格）。着地シミュレーションと同じ積み方
    const expectedAdr = rec?.predictedAdr ?? rec?.recommendedPrice ?? null
    const expectedRevenue =
      rec?.predictedOccupancy != null && expectedAdr != null
        ? Math.round(Math.round(totalRooms * rec.predictedOccupancy) * expectedAdr)
        : null

    // 日のタイプ（日のモデル）: 区分（平日・週末・特日）の型のうち、今の予約の入り方に近い型。予約が進むと型が変わる
    const dayType = buildDayTypeTimeline({
      stayDate: day,
      today,
      totalRooms,
      types: dayTypeModel.typesFor(day),
      points,
      actualSoldRooms: actual?.soldRooms ?? null,
      predictedOccupancy: rec?.predictedOccupancy ?? null,
    })

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
      // 日割り予算（月次予算を前年同曜日の販売室数の比で配ったもの）
      budgetRooms: budget.rooms,
      budgetOccupancy: budget.occupancy,
      budgetAdr: budget.adr,
      budgetRevenue: budget.revenue,
      onHandRooms,
      currentOccupancy,
      // 予約（オンハンド）の単価・売上は PMS 連携（Phase 4）で入る。今は結果の出た日の実績だけ
      onHandAdr: actual?.adr ?? null,
      currentRevenue: actual?.totalRevenue ?? null,
      expectedRevenue,
      dayType: dayType.current?.name ?? null,
      dayTypeModel: dayType.current?.model ?? null,
      dayTypeTypicalOccupancy: dayType.current?.typicalOccupancy ?? null,
      dayTypeHistory: dayType.history,
    }
  })

  if (!roomType) return { hotelId, year, month, totalRooms, roomType: null, calendar }

  // タイプ別: その月のタイプ別の実績と、配分に使う過去の販売構成（有効なタイプだけで割合を出す）
  const mixFrom = addUtcDays(today, -ROOM_TYPE_MIX_DAYS)
  const [typeActuals, mixTotals, activeTypes] = await Promise.all([
    prisma.dailyRoomData.findMany({
      where: { roomTypeId: roomType.id, dailyData: { hotelId, date: { gte: start, lt: end } } },
      select: { soldRooms: true, revenue: true, dailyData: { select: { date: true } } },
    }),
    prisma.dailyRoomData.groupBy({
      by: ['roomTypeId'],
      where: { roomType: { hotelId, isActive: true }, dailyData: { hotelId, date: { gte: mixFrom, lt: today } } },
      _sum: { soldRooms: true, revenue: true },
    }),
    prisma.roomType.findMany({ where: { hotelId, isActive: true }, select: { count: true } }),
  ])
  const activeCount = activeTypes.reduce((a, t) => a + t.count, 0)
  const mix = roomTypeMixFrom(
    mixTotals.map((t) => ({ roomTypeId: t.roomTypeId, soldRooms: t._sum.soldRooms ?? 0, revenue: t._sum.revenue ?? 0 })),
    roomType.id,
    activeCount > 0 ? roomType.count / activeCount : 0
  )
  const typeActualByDate = new Map(typeActuals.map((a) => [a.dailyData.date.toISOString().slice(0, 10), a]))

  return {
    hotelId,
    year,
    month,
    // 稼働率・月計はこのタイプの室数に対して出す
    totalRooms: roomType.count,
    roomType: { id: roomType.id, name: roomType.name, count: roomType.count },
    calendar: calendar.map((day) =>
      toRoomTypeDay(day, { count: roomType.count, hotelRooms: totalRooms, mix, actual: typeActualByDate.get(day.date) ?? null })
    ),
  }
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
    dayModelAdjust: true,
    priceElasticity: 1,
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
  dayModelAdjust?: boolean
  priceElasticity?: number
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

// ======================================
// 期間・曜日ごとの価格の幅（推奨ランクの下限・上限 — D-11）
// ======================================

export async function listPriceBoundsService(hotelId: string) {
  return prisma.priceBoundPeriod.findMany({
    where: { hotelId, endDate: { gte: todayJst() } },
    orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
  })
}

export async function createPriceBoundService(
  input: {
    hotelId: string
    startDate: Date
    endDate: Date
    weekdays: number[]
    minRank?: number | null
    maxRank?: number | null
    reason?: string
  },
  createdByUserId: string
) {
  const hotel = await prisma.hotel.findFirst({ where: { id: input.hotelId, isActive: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  return prisma.priceBoundPeriod.create({
    data: {
      ...input,
      weekdays: [...input.weekdays].sort((a, b) => a - b),
      minRank: input.minRank ?? null,
      maxRank: input.maxRank ?? null,
      tenantId: hotel.tenantId,
      createdByUserId,
    },
  })
}

export async function deletePriceBoundService(id: string, hotelId: string) {
  const existing = await prisma.priceBoundPeriod.findFirst({ where: { id, hotelId } })
  if (!existing) throw new NotFoundError('価格の幅')
  const result = await prisma.priceBoundPeriod.deleteMany({ where: { id, hotelId } })
  if (result.count === 0) throw new NotFoundError('価格の幅')
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
