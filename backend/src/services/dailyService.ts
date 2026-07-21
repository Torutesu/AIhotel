import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'

/**
 * ブッキングカーブ（F-DAILY-01）
 * X軸 = 宿泊日までの残日数（降順で右肩上がりになる）
 */
export async function getBookingCurveService(hotelId: string, stayDate: Date) {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
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
 * 競合価格比較（F-DAILY-03）
 * ホテル別（"平均"ではなく各ホテルの販売価格 — F-ANA-02）・利用人数別価格を返す
 */
export async function getCompetitorPricesService(
  hotelId: string,
  startDate: Date,
  endDate: Date
) {
  const [competitors, ownRecommendations, ownActuals] = await Promise.all([
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
    }),
  ])

  const ownActualByDate = new Map(ownActuals.map((d) => [d.date.toISOString().slice(0, 10), d]))

  return {
    hotelId,
    startDate: startDate.toISOString().slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10),
    // 自ホテル: 実績日は ADR、未来日は AI 推奨価格
    ownPrices: ownRecommendations.map((r) => {
      const key = r.date.toISOString().slice(0, 10)
      const actual = ownActualByDate.get(key)
      return {
        date: key,
        price: actual?.adr != null ? Math.round(actual.adr) : r.recommendedPrice,
        isActual: actual?.adr != null,
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
