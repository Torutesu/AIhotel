import { prisma } from '../lib/prisma.js'
import { BadRequestError, NotFoundError } from '../middlewares/errorHandler.js'
import { addUtcDays, todayJst } from '../lib/date.js'
import { loadDayTypeModel } from './dayTypeService.js'
import { buildDayTypeTimeline, DAY_CATEGORY_LABELS, weightsForModel, type DayModel } from './forecast/dayType.js'
import { outcomeAt, simulateOccupancy, type SimulatedOutcome } from './forecast/daySimulation.js'
import { leadDaysBetween, otbAtLead, type BookingCurvePoint } from './forecast/pace.js'
import { ruleBasedForecaster } from './forecast/ruleBasedForecaster.js'
import { OCCUPANCY_ONLY_WEIGHTS } from './forecast/strategyWeighting.js'

// 日のAI分析（2026-10 の画面修正 PDF b01・b03、xlsx DP03）。
//   - 日の詳細: 日のタイプと推移、型の典型（平均稼働・典型カーブ）、同じタイプの日（参考に5日）、その日の外部要因（イベント・天候）
//   - 日単位のシミュレーション: 優先モデル（稼働優先・バランス・単価優先）や料金ランクを変えたときの見込み（保存しない）

const iso = (d: Date) => d.toISOString().slice(0, 10)

/** 同じタイプの日を探す範囲（前後の日数） */
export const SIMILAR_DAY_RANGE = 60
/** 同じタイプの日として出す日数 */
export const SIMILAR_DAY_COUNT = 5

export interface SimilarDay {
  date: string
  dayType: string
  /** 結果の出た日か（結果なら稼働・ADR は実績、先の日は AI の予測） */
  isActual: boolean
  occupancy: number | null
  adr: number | null
  recommendedPrice: number | null
}

/** 選んだ日と同じ型の日を、日付の近い順に count 日選び、日付順に並べる（純関数） */
export function pickSimilarDays<T extends { date: string; dayType: string | null }>(
  candidates: T[],
  target: { date: string; dayType: string | null },
  count = SIMILAR_DAY_COUNT
): T[] {
  if (!target.dayType) return []
  const distance = (d: string) => Math.abs(new Date(`${d}T00:00:00Z`).getTime() - new Date(`${target.date}T00:00:00Z`).getTime())
  return candidates
    .filter((c) => c.date !== target.date && c.dayType === target.dayType)
    .sort((a, b) => distance(a.date) - distance(b.date) || a.date.localeCompare(b.date))
    .slice(0, count)
    .sort((a, b) => a.date.localeCompare(b.date))
}

export async function getDayInsightService(hotelId: string, date: Date) {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, isActive: true }, select: { totalRooms: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  const totalRooms = hotel.totalRooms
  const today = todayJst()
  const from = addUtcDays(date, -SIMILAR_DAY_RANGE)
  const to = addUtcDays(date, SIMILAR_DAY_RANGE)
  const curveFrom = from > today ? from : today

  const [model, daily, recommendations, curveRows, events] = await Promise.all([
    loadDayTypeModel(hotelId, today),
    prisma.dailyData.findMany({
      where: { hotelId, date: { gte: from, lte: to } },
      select: { date: true, soldRooms: true, occupancy: true, adr: true },
    }),
    prisma.aiPriceRecommendation.findMany({
      where: { hotelId, roomTypeId: null, date: { gte: from, lte: to } },
      select: { date: true, predictedOccupancy: true, predictedAdr: true, recommendedPrice: true },
    }),
    // 先の日の予約積上（型の判定に使う）と、選んだ日の予約積上（推移に使う。過去の日でも読む）
    prisma.bookingCurveData.findMany({
      where: { hotelId, OR: [{ stayDate: { gte: curveFrom, lte: to } }, { stayDate: date }] },
      select: { stayDate: true, daysBefore: true, roomsBooked: true },
    }),
    prisma.event.findMany({
      where: { hotelId, startDate: { lte: date }, endDate: { gte: date } },
      select: { name: true, type: true, location: true, expectedImpact: true, excludeFromHistory: true },
      orderBy: { startDate: 'asc' },
    }),
  ])

  const curves = new Map<number, BookingCurvePoint[]>()
  for (const row of curveRows) {
    const list = curves.get(row.stayDate.getTime()) ?? []
    list.push(row)
    curves.set(row.stayDate.getTime(), list)
  }
  const actualByDate = new Map(daily.map((d) => [d.date.getTime(), d]))
  const recByDate = new Map(recommendations.map((r) => [r.date.getTime(), r]))

  const timelineOf = (day: Date) => {
    const actual = actualByDate.get(day.getTime())
    return buildDayTypeTimeline({
      stayDate: day,
      today,
      totalRooms,
      types: model.typesFor(day),
      points: curves.get(day.getTime()) ?? [],
      actualSoldRooms: actual?.soldRooms ?? null,
      predictedOccupancy: recByDate.get(day.getTime())?.predictedOccupancy ?? null,
    })
  }

  const timeline = timelineOf(date)
  const current = timeline.current
  const profile = current ? (model.types.find((t) => t.id === current.id) ?? null) : null

  const candidates: SimilarDay[] = []
  for (let i = -SIMILAR_DAY_RANGE; i <= SIMILAR_DAY_RANGE; i++) {
    if (i === 0) continue
    const day = addUtcDays(date, i)
    const type = timelineOf(day).current
    if (!type) continue
    const actual = actualByDate.get(day.getTime())
    const rec = recByDate.get(day.getTime())
    candidates.push({
      date: iso(day),
      dayType: type.name,
      isActual: actual != null,
      occupancy: actual?.occupancy ?? rec?.predictedOccupancy ?? null,
      adr: actual?.adr ?? rec?.predictedAdr ?? null,
      recommendedPrice: rec?.recommendedPrice ?? null,
    })
  }

  return {
    date: iso(date),
    category: DAY_CATEGORY_LABELS[model.categoryOf(date)],
    dayType: current ? { name: current.name, model: current.model, typicalOccupancy: current.typicalOccupancy } : null,
    history: timeline.history,
    /** 選んだ日の型の典型（平均稼働・典型カーブ） */
    typeProfile: profile
      ? {
          name: profile.name,
          model: profile.model,
          days: profile.days,
          avgOccupancy: profile.avgOccupancy,
          minOccupancy: profile.minOccupancy,
          maxOccupancy: profile.maxOccupancy,
          avgAdr: profile.avgAdr,
          referenceCurve: profile.curveShare.map((p) => ({
            daysBefore: p.daysBefore,
            roomsBooked: Math.round(p.share * profile.avgOccupancy * totalRooms),
          })),
        }
      : null,
    /** 同じ区分の型の一覧（AI が作った型の数と構成） */
    categoryTypes: model
      .typesFor(date)
      .map((t) => ({ name: t.name, model: t.model, days: t.days, avgOccupancy: t.avgOccupancy, avgAdr: t.avgAdr })),
    similarDays: pickSimilarDays(candidates, { date: iso(date), dayType: current?.name ?? null }),
    /** その日の外部要因（登録したイベント）。天候は外部データの取り込み前のため無い */
    events,
    weather: null,
  }
}

export interface SimulationOption extends SimulatedOutcome {
  /** モデル（稼働優先・バランス・単価優先）。ランクを指定した試算は 'manual' */
  model: DayModel | 'manual'
  rank: number | null
  price: number | null
  adr: number | null
  /** そのモデルで使う重み（%）。ランク指定の試算は null */
  weights: { occupancy: number; adr: number; competitor: number } | null
  /** AI が今この日に割り当てているモデルか */
  isCurrent: boolean
}

/**
 * 日単位のシミュレーション（保存しない）。
 * 優先モデルごとに推奨を出し直し、AI の推奨（今のモデル）からの単価の差に価格弾力性をかけて稼働の見込みを出す。rank を渡すとそのランクでも試算する
 */
export async function getDaySimulationService(hotelId: string, date: Date, rank?: number) {
  const today = todayJst()
  if (date < today) throw new BadRequestError('過去の日は試算できません。今日以降の日を選んでください')
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, isActive: true }, select: { totalRooms: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  const totalRooms = hotel.totalRooms

  const run = (modelOverride?: DayModel) =>
    ruleBasedForecaster.forecast({ hotelId, startDate: date, endDate: date, modelOverride }).then((r) => r[0])
  const [base, byOccupancy, byBalanced, byAdr, config, ranks, curve] = await Promise.all([
    run(),
    run('occupancy'),
    run('balanced'),
    run('adr'),
    prisma.pricingStrategyConfig.findUnique({ where: { hotelId } }),
    prisma.priceRank.findMany({ where: { hotelId, isActive: true }, select: { rank: true, price1P: true }, orderBy: { rank: 'asc' } }),
    prisma.bookingCurveData.findMany({ where: { hotelId, stayDate: date }, select: { stayDate: true, daysBefore: true, roomsBooked: true } }),
  ])
  if (rank != null && !ranks.some((r) => r.rank === rank)) throw new BadRequestError('指定した料金ランクは登録されていません')

  const elasticity = config?.priceElasticity ?? 1
  const weights = config
    ? { weightOccupancy: config.weightOccupancy, weightAdr: config.weightAdr, weightCompetitor: config.weightCompetitor }
    : OCCUPANCY_ONLY_WEIGHTS
  const otbRooms = otbAtLead(curve, Math.max(0, leadDaysBetween(today, date)))
  const baseAdr = base.predictedAdr ?? base.recommendedPrice
  const aiModel = base.rationale?.dayType?.model ?? null

  const optionOf = (model: DayModel, f: typeof base): SimulationOption => {
    const adr = f.predictedAdr ?? f.recommendedPrice
    const occupancy =
      baseAdr != null && adr != null
        ? simulateOccupancy({ baseOccupancy: base.predictedOccupancy, basePrice: baseAdr, price: adr, elasticity, totalRooms, otbRooms })
        : base.predictedOccupancy
    const w = weightsForModel(weights, model)
    return {
      model,
      rank: f.recommendedRank,
      price: f.recommendedPrice,
      adr,
      weights: { occupancy: w.weightOccupancy, adr: w.weightAdr, competitor: w.weightCompetitor },
      isCurrent: aiModel === model,
      ...outcomeAt(occupancy, adr ?? 0, totalRooms),
    }
  }

  const options = [optionOf('occupancy', byOccupancy), optionOf('balanced', byBalanced), optionOf('adr', byAdr)]

  let manual: SimulationOption | null = null
  if (rank != null) {
    const price = ranks.find((r) => r.rank === rank)?.price1P ?? null
    const basePrice = base.recommendedRank != null ? (ranks.find((r) => r.rank === base.recommendedRank)?.price1P ?? null) : null
    // 予測ADR は1名料金の比で動かす（需要予測の computePredictedAdr と同じ考え方）
    const adr = price != null && basePrice != null && baseAdr != null ? Math.round(baseAdr * (price / basePrice)) : price
    const occupancy =
      baseAdr != null && adr != null
        ? simulateOccupancy({ baseOccupancy: base.predictedOccupancy, basePrice: baseAdr, price: adr, elasticity, totalRooms, otbRooms })
        : base.predictedOccupancy
    manual = { model: 'manual', rank, price, adr, weights: null, isCurrent: false, ...outcomeAt(occupancy, adr ?? 0, totalRooms) }
  }

  return {
    date: iso(date),
    totalRooms,
    otbRooms,
    elasticity,
    /** AI が今この日に割り当てているモデル（「日のタイプに合わせて重みを寄せる」を切っていれば null） */
    aiModel,
    dayType: base.rationale?.dayType?.name ?? null,
    /** AI の推奨（今のモデル） */
    base: {
      rank: base.recommendedRank,
      price: base.recommendedPrice,
      adr: baseAdr,
      ...outcomeAt(base.predictedOccupancy, baseAdr ?? 0, totalRooms),
    },
    options,
    manual,
  }
}
