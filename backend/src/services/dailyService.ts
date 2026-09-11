import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'

/**
 * ブッキングカーブ（F-DAILY-01）
 * X軸 = 宿泊日までの残日数（降順で右肩上がりになる）
 */
export async function getBookingCurveService(hotelId: string, stayDate: Date) {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, isActive: true } })
  if (!hotel) throw new NotFoundError('ホテル')

  const points = await prisma.bookingCurveData.findMany({
    where: { hotelId, stayDate },
    orderBy: { daysBefore: 'desc' },
  })

  return {
    hotelId,
    stayDate: stayDate.toISOString().slice(0, 10),
    totalRooms: hotel.totalRooms,
    points: points.map((p) => ({
      daysBefore: p.daysBefore,
      roomsBooked: p.roomsBooked,
      occupancy: Math.round((p.roomsBooked / hotel.totalRooms) * 1000) / 1000,
    })),
  }
}

/**
 * 自館の利用人数別価格の入力（DailyRoomData のうち価格算出に使う項目のみ）
 */
export interface OwnRoomPriceRecord {
  price1P: number | null
  price2P: number | null
  price3P: number | null
  soldRooms: number | null
}

/** 料金ランク（PriceRank のうち利用人数別価格のみ） */
export interface OwnRankPrices {
  price1P: number
  price2P: number
  price3P: number | null
}

/** 自館の利用人数別価格（1名／2名／3名）。値が無い人数は null */
export interface OwnGuestPrices {
  price1P: number | null
  price2P: number | null
  price3P: number | null
}

/**
 * 客室タイプ別の販売価格を販売室数で加重平均する。
 * 販売室数が未入力のタイプは重み1（単純平均）として扱い、
 * 有効な価格が1件も無ければ null を返す（0 で埋めない）。
 */
function weightedAverage(
  rows: OwnRoomPriceRecord[],
  pick: (row: OwnRoomPriceRecord) => number | null
): number | null {
  let weightSum = 0
  let valueSum = 0
  for (const row of rows) {
    const value = pick(row)
    if (value == null) continue
    const weight = row.soldRooms != null && row.soldRooms > 0 ? row.soldRooms : 1
    valueSum += value * weight
    weightSum += weight
  }
  return weightSum > 0 ? Math.round(valueSum / weightSum) : null
}

/**
 * ある日の自館の利用人数別価格を決める（#57）。
 *
 * 競合は 1名／2名／3名それぞれの販売価格を持つのに対し、自館側は
 * 日次ADR（人数非依存の1室あたり平均単価）しか返しておらず、
 * 画面の「自館価格」が 1名/2名/3名 で同じ値になっていた。
 *
 * 優先順位:
 *   1. 客室タイプ別の販売価格実績（DailyRoomData）— 販売室数で加重平均する
 *   2. AI 推奨ランクに対応する料金ランク（PriceRank）の人数別価格
 * どちらも無い人数は null（画面は「-」を表示し、ADR で代用しない）。
 */
export function resolveOwnGuestPrices(
  roomData: OwnRoomPriceRecord[],
  rank: OwnRankPrices | undefined
): OwnGuestPrices {
  return {
    price1P: weightedAverage(roomData, (r) => r.price1P) ?? rank?.price1P ?? null,
    price2P: weightedAverage(roomData, (r) => r.price2P) ?? rank?.price2P ?? null,
    price3P: weightedAverage(roomData, (r) => r.price3P) ?? rank?.price3P ?? null,
  }
}

/**
 * 競合価格比較（F-DAILY-03）
 * ホテル別（"平均"ではなく各ホテルの販売価格 — F-ANA-02）・利用人数別価格を返す
 */
export async function getCompetitorPricesService(
  hotelId: string,
  startDate: Date,
  endDate: Date
) {
  const [competitors, ownRecommendations, ownActuals, priceRanks] = await Promise.all([
    prisma.competitor.findMany({
      where: { hotelId, isActive: true },
      include: {
        priceData: {
          where: { date: { gte: startDate, lte: endDate } },
          orderBy: { date: 'asc' },
        },
      },
    }),
    prisma.aiPriceRecommendation.findMany({
      where: { hotelId, roomTypeId: null, date: { gte: startDate, lte: endDate } },
      orderBy: { date: 'asc' },
    }),
    prisma.dailyData.findMany({
      where: { hotelId, date: { gte: startDate, lte: endDate } },
      orderBy: { date: 'asc' },
      // 客室タイプ別の販売価格（利用人数別の自館価格の第一候補 — #57）
      include: { roomData: true },
    }),
    prisma.priceRank.findMany({ where: { hotelId, isActive: true } }),
  ])

  const ownActualByDate = new Map(ownActuals.map((d) => [d.date.toISOString().slice(0, 10), d]))
  const rankByNumber = new Map(priceRanks.map((r) => [r.rank, r]))

  return {
    hotelId,
    startDate: startDate.toISOString().slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10),
    // 自ホテル: 実績日は ADR、未来日は AI 推奨価格。
    // 利用人数別の価格は price1P / price2P / price3P に入れる（#57）
    ownPrices: ownRecommendations.map((r) => {
      const key = r.date.toISOString().slice(0, 10)
      const actual = ownActualByDate.get(key)
      const rank = r.recommendedRank != null ? rankByNumber.get(r.recommendedRank) : undefined
      return {
        date: key,
        price: actual?.adr != null ? Math.round(actual.adr) : r.recommendedPrice,
        isActual: actual?.adr != null,
        ...resolveOwnGuestPrices(actual?.roomData ?? [], rank),
      }
    }),
    competitors: competitors.map((c) => ({
      id: c.id,
      name: c.name,
      category: c.category,
      prices: c.priceData.map((p) => ({
        date: p.date.toISOString().slice(0, 10),
        price1P: p.price1P,
        price2P: p.price2P,
        price3P: p.price3P,
        reliability: p.reliability,
      })),
    })),
  }
}
