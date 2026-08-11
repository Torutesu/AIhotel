import { prisma } from '../../lib/prisma.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'
import { diffDays, type FeatureContext } from './features.js'

// ======================================
// 特徴量の材料をDBから集める層（4E-1）
//
// features.ts を純関数に保つため、DBアクセスはすべてここに寄せる。
//
// リーク防止の要は「predictedAt より後に取得した断面を読まない」こと。
// OnHandSnapshot / RoomInventorySnapshot は capturedDate を持っているので、
// 必ず capturedDate <= predictedAt で絞る。実績（ReservationNight）も
// 宿泊日が predictedAt より前のものしか使わない。
// ======================================

const MS_PER_DAY = 86_400_000

function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * MS_PER_DAY)
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** 前年同日。うるう年で日がずれないよう「364日前（52週）」を使い、曜日も揃える */
function sameWeekdayLastYear(d: Date): Date {
  return addDays(d, -364)
}

export interface FeatureSourceData {
  hotelId: string
  totalRooms: number
  weekendDays: number[]
  /** 宿泊日 -> 実績稼働率 */
  actualOccupancyByDate: Map<string, number>
  /** `${stayDate}|${capturedDate}` -> オンハンド稼働率 */
  onHandByStayAndCaptured: Map<string, number>
  /** 宿泊日 -> 特日の種別 */
  specialDayKinds: Map<string, Set<string>>
  /** 宿泊日 -> 重なる外部要因 */
  externalFactorsByDate: Map<string, Array<{ impactScore: number | null }>>
  /** `${stayDate}|${capturedDate}` -> 残室率 */
  remainingRatioByStayAndCaptured: Map<string, number>
}

/**
 * 期間分の材料をまとめて読む。
 * 1日1クエリではなく期間で一括取得する（180日×毎日の予測でN+1にしないため）。
 */
export async function loadFeatureSourceData(
  hotelId: string,
  rangeStart: Date,
  rangeEnd: Date
): Promise<FeatureSourceData> {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  // 前年同期の比較と28日移動平均のため、開始日より前も読む必要がある
  const historyStart = addDays(dateOnly(rangeStart), -400)
  const end = dateOnly(rangeEnd)

  const [nights, onHand, specialDays, factors, inventory] = await Promise.all([
    prisma.reservationNight.groupBy({
      by: ['stayDate'],
      where: { hotelId, stayDate: { gte: historyStart, lte: end }, isDayUse: false },
      _sum: { rooms: true },
    }),
    prisma.onHandSnapshot.findMany({
      where: { hotelId, stayDate: { gte: historyStart, lte: end } },
      select: { stayDate: true, capturedDate: true, rooms: true },
    }),
    prisma.specialDay.findMany({
      where: { hotelId, date: { gte: historyStart, lte: end } },
      select: { date: true, kind: true },
    }),
    prisma.externalFactor.findMany({
      where: { hotelId, startDate: { lte: end }, endDate: { gte: historyStart } },
      select: { startDate: true, endDate: true, impactScore: true },
    }),
    prisma.roomInventorySnapshot.groupBy({
      by: ['stayDate', 'capturedDate'],
      where: { hotelId, stayDate: { gte: historyStart, lte: end } },
      _sum: { remainingRooms: true },
    }),
  ])

  const totalRooms = hotel.totalRooms > 0 ? hotel.totalRooms : 1

  const actualOccupancyByDate = new Map<string, number>()
  for (const row of nights) {
    actualOccupancyByDate.set(dateKey(row.stayDate), (row._sum.rooms ?? 0) / totalRooms)
  }

  const onHandByStayAndCaptured = new Map<string, number>()
  for (const row of onHand) {
    onHandByStayAndCaptured.set(
      `${dateKey(row.stayDate)}|${dateKey(row.capturedDate)}`,
      row.rooms / totalRooms
    )
  }

  const specialDayKinds = new Map<string, Set<string>>()
  for (const row of specialDays) {
    const key = dateKey(row.date)
    const set = specialDayKinds.get(key) ?? new Set<string>()
    set.add(row.kind)
    specialDayKinds.set(key, set)
  }

  const externalFactorsByDate = new Map<string, Array<{ impactScore: number | null }>>()
  for (const factor of factors) {
    for (
      let d = dateOnly(factor.startDate);
      d <= dateOnly(factor.endDate);
      d = addDays(d, 1)
    ) {
      const key = dateKey(d)
      const list = externalFactorsByDate.get(key) ?? []
      list.push({ impactScore: factor.impactScore })
      externalFactorsByDate.set(key, list)
    }
  }

  const remainingRatioByStayAndCaptured = new Map<string, number>()
  for (const row of inventory) {
    remainingRatioByStayAndCaptured.set(
      `${dateKey(row.stayDate)}|${dateKey(row.capturedDate)}`,
      (row._sum.remainingRooms ?? 0) / totalRooms
    )
  }

  return {
    hotelId,
    totalRooms,
    weekendDays: parseWeekendDays(hotel.weekendDays),
    actualOccupancyByDate,
    onHandByStayAndCaptured,
    specialDayKinds,
    externalFactorsByDate,
    remainingRatioByStayAndCaptured,
  }
}

function parseWeekendDays(value: unknown): number[] {
  if (Array.isArray(value)) {
    const days = value.filter((v): v is number => typeof v === 'number' && v >= 0 && v <= 6)
    if (days.length > 0) return days
  }
  return [5, 6] // 金・土（要件定義書 §4）
}

/**
 * predictedAt 以前で最も新しいオンハンド断面を探す。
 * 断面は毎日取れるとは限らない（取込が落ちた日がある）ので、遡って探す。
 */
function latestOnHandAt(
  data: FeatureSourceData,
  stayDate: Date,
  predictedAt: Date,
  lookbackDays = 14
): { occupancy: number; capturedDate: Date } | null {
  const stayKey = dateKey(stayDate)
  for (let i = 0; i <= lookbackDays; i += 1) {
    const captured = addDays(predictedAt, -i)
    const value = data.onHandByStayAndCaptured.get(`${stayKey}|${dateKey(captured)}`)
    if (value != null) return { occupancy: value, capturedDate: captured }
  }
  return null
}

/** 直近windowDaysの同曜日平均稼働率（predictedAt より前の実績のみ） */
function sameWeekdayMovingAverage(
  data: FeatureSourceData,
  stayDate: Date,
  predictedAt: Date,
  windowDays = 28
): number | null {
  const dow = stayDate.getUTCDay()
  const values: number[] = []
  for (let i = 1; i <= windowDays; i += 1) {
    const d = addDays(predictedAt, -i)
    if (d.getUTCDay() !== dow) continue
    const occupancy = data.actualOccupancyByDate.get(dateKey(d))
    if (occupancy != null) values.push(occupancy)
  }
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

/** 直近7日の平均稼働率（predictedAt より前の実績のみ） */
function trailingAverage(
  data: FeatureSourceData,
  predictedAt: Date,
  windowDays = 7
): number | null {
  const values: number[] = []
  for (let i = 1; i <= windowDays; i += 1) {
    const occupancy = data.actualOccupancyByDate.get(dateKey(addDays(predictedAt, -i)))
    if (occupancy != null) values.push(occupancy)
  }
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * 1件分の FeatureContext を組み立てる。
 * 使うのは predictedAt 時点で判明している情報だけ（リーク防止）。
 */
export function buildFeatureContext(
  data: FeatureSourceData,
  stayDate: Date,
  predictedAt: Date
): FeatureContext {
  const stayKey = dateKey(stayDate)
  const kinds = data.specialDayKinds.get(stayKey)
  const prevKinds = data.specialDayKinds.get(dateKey(addDays(stayDate, -1)))
  const nextKinds = data.specialDayKinds.get(dateKey(addDays(stayDate, 1)))

  const onHandNow = latestOnHandAt(data, stayDate, predictedAt)
  const onHand7dAgo = latestOnHandAt(data, stayDate, addDays(predictedAt, -7))

  // 前年同時期の「同じリードタイム」での積み上がり。多いか少ないかの判断材料
  const leadTime = diffDays(predictedAt, stayDate)
  const lastYearStay = sameWeekdayLastYear(stayDate)
  const lastYearCaptured = addDays(lastYearStay, -leadTime)
  const onHandLastYear =
    data.onHandByStayAndCaptured.get(`${dateKey(lastYearStay)}|${dateKey(lastYearCaptured)}`) ?? null

  const factors = data.externalFactorsByDate.get(stayKey) ?? []

  return {
    stayDate,
    predictedAt,
    weekendDays: data.weekendDays,
    isHoliday: kinds?.has('HOLIDAY') ?? false,
    isTokujitsu: kinds?.has('TOKUJITSU') ?? false,
    isDayBeforeSpecial: (nextKinds?.size ?? 0) > 0,
    isDayAfterSpecial: (prevKinds?.size ?? 0) > 0,
    onHandOccupancy: onHandNow?.occupancy ?? null,
    onHandLastYearSameLead: onHandLastYear,
    pickup7d:
      onHandNow && onHand7dAgo ? Math.max(0, onHandNow.occupancy - onHand7dAgo.occupancy) : null,
    remainingRatio:
      data.remainingRatioByStayAndCaptured.get(`${stayKey}|${dateKey(predictedAt)}`) ?? null,
    sameWeekdayMa28: sameWeekdayMovingAverage(data, stayDate, predictedAt),
    yearOverYearOccupancy: data.actualOccupancyByDate.get(dateKey(lastYearStay)) ?? null,
    trailing7dOccupancy: trailingAverage(data, predictedAt),
    externalImpactSum: factors.reduce((sum, f) => sum + (f.impactScore ?? 0), 0),
    externalFactorCount: factors.length,
  }
}

/** 実績稼働率（学習の教師データ）。実績が無い日は null */
export function actualOccupancyOf(data: FeatureSourceData, stayDate: Date): number | null {
  return data.actualOccupancyByDate.get(dateKey(stayDate)) ?? null
}
