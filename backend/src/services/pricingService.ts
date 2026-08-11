import type { RateCategory } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { NotFoundError } from '../middlewares/errorHandler.js'

function monthRange(year: number, month: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  }
}

/**
 * 日別価格カレンダー（F-DP-01）
 * 表示は1ヶ月固定＋月選択（モックアップ修正内容.xlsx ①）。
 * 部屋タイプ×レート区分ごとの料金ランク（新モデル）に基づき、
 * 現在ADR・推奨ADR・推奨ランク・アラート（需要レベル）・特日を日別に返す。
 *
 * roomTypeId 未指定時はマスタ先頭の部屋タイプを既定にする（同 ②「全タイプ表示はなし」）。
 */
export async function getPricingCalendarService(
  hotelId: string,
  year: number,
  month: number,
  options: { roomTypeId?: string; rateCategory?: RateCategory } = {}
) {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const { start, end } = monthRange(year, month)
  const rateCategory: RateCategory = options.rateCategory ?? 'OWN'

  // 部屋タイプ未指定時の既定（モックアップ修正 ②「デフォルトでマスタの一番上のものをデフォルト表示」）。
  // ただし料金表が未登録のタイプを既定にすると価格が出ないため、
  // 料金表を持つ最初のタイプ → 無ければマスタ先頭、の順で選ぶ。
  const roomTypes = await prisma.roomType.findMany({
    where: { hotelId, isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    select: { id: true, code: true, name: true, capacity: true },
  })

  let selectedRoomType = options.roomTypeId
    ? roomTypes.find((rt) => rt.id === options.roomTypeId)
    : undefined
  if (options.roomTypeId && !selectedRoomType) throw new NotFoundError('部屋タイプ')

  if (!selectedRoomType) {
    const firstWithTable = await prisma.priceRank.findFirst({
      where: { hotelId, rateCategory, isActive: true },
      orderBy: [{ roomType: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
      select: { roomTypeId: true },
    })
    selectedRoomType =
      roomTypes.find((rt) => rt.id === firstWithTable?.roomTypeId) ?? roomTypes[0]
  }

  const [recommendations, dailyData, priceRanks, competitorPrices, specialDays] = await Promise.all([
    prisma.aiPriceRecommendation.findMany({
      where: { hotelId, date: { gte: start, lt: end }, roomTypeId: null },
      orderBy: { date: 'asc' },
    }),
    prisma.dailyData.findMany({
      where: { hotelId, date: { gte: start, lt: end } },
    }),
    selectedRoomType
      ? prisma.priceRank.findMany({
          where: {
            hotelId,
            roomTypeId: selectedRoomType.id,
            rateCategory,
            isActive: true,
          },
          orderBy: { sortOrder: 'desc' },
        })
      : Promise.resolve([]),
    prisma.competitorPriceData.findMany({
      where: {
        date: { gte: start, lt: end },
        competitor: { hotelId },
      },
      select: { date: true, price1P: true },
    }),
    // 曜日欄の色分け用（祝日=色のみ / 特日=別色 — F-DP-08）
    prisma.specialDay.findMany({
      where: { hotelId, date: { gte: start, lt: end } },
    }),
  ])

  const rankByCode = new Map(priceRanks.map((r) => [r.rankCode, r]))
  const actualByDate = new Map(dailyData.map((d) => [d.date.toISOString().slice(0, 10), d]))
  const specialByDate = new Map<string, (typeof specialDays)[number]>()
  for (const sd of specialDays) {
    const key = sd.date.toISOString().slice(0, 10)
    // 同日に複数ある場合は特日を優先して表示する
    const existing = specialByDate.get(key)
    if (!existing || (existing.kind === 'HOLIDAY' && sd.kind === 'TOKUJITSU')) {
      specialByDate.set(key, sd)
    }
  }

  // 競合価格（日別）。"平均"表現の扱いは §4 の確認結果に従う
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
    const rank = rec.recommendedRankCode != null ? rankByCode.get(rec.recommendedRankCode) : undefined
    const compPrices = competitorByDate.get(key)
    const special = specialByDate.get(key)
    return {
      date: key,
      // 需要レベルA〜E。画面表示名は「アラート」（モックアップ修正 ④）
      demandLevel: rec.demandLevel,
      recommendedRankCode: rec.recommendedRankCode,
      // 選択中の部屋タイプ×レート区分の料金表から引いた価格。
      // 料金表が未登録なら他タイプの価格を出さず null にする（誤表示防止）
      recommendedPrice: rank?.price ?? null,
      predictedOccupancy: rec.predictedOccupancy,
      predictedAdr: rec.predictedAdr,
      // 実績確定後に表示する結果系（同 ⑤「実績に変わったら数値を表示」）
      actualOccupancy: actual?.occupancy ?? null,
      actualAdr: actual?.adr ?? null,
      // 推奨との差異（AI学習・コメント材料）
      adrDiff: actual?.adr != null && rec.predictedAdr != null ? Math.round(actual.adr - rec.predictedAdr) : null,
      occupancyDiff:
        actual?.occupancy != null && rec.predictedOccupancy != null
          ? Math.round((actual.occupancy - rec.predictedOccupancy) * 1000) / 1000
          : null,
      competitorAvgPrice:
        compPrices && compPrices.length > 0
          ? Math.round(compPrices.reduce((a, b) => a + b, 0) / compPrices.length)
          : null,
      confidence: rec.confidence,
      specialDay: special ? { name: special.name, kind: special.kind, color: special.color } : null,
    }
  })

  return {
    hotelId,
    year,
    month,
    roomType: selectedRoomType ?? null,
    roomTypes,
    rateCategory,
    // この部屋タイプ×レート区分に料金表があるか（無い場合UIで案内する）
    hasPriceTable: priceRanks.length > 0,
    calendar,
  }
}

/**
 * 月間着地シミュレーション（F-DP-04）
 * 現在値（実績＋オンハンド）と着地予測をADR・稼働率・RevPerの3指標で併記する
 * （モックアップ修正内容.xlsx ④⑤⑥）。
 */
export async function getSimulationService(hotelId: string, year: number, month: number) {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const { start, end } = monthRange(year, month)

  const [simulation, budget, dailyData] = await Promise.all([
    prisma.monthlyLandingSimulation.findUnique({
      where: { hotelId_year_month: { hotelId, year, month } },
    }),
    prisma.monthlyBudget.findUnique({
      where: { hotelId_year_month: { hotelId, year, month } },
    }),
    prisma.dailyData.findMany({ where: { hotelId, date: { gte: start, lt: end } } }),
  ])

  // 現在値: 実績が入っている日までの集計
  const actualDays = dailyData.filter((d) => d.totalRevenue != null)
  const revenue = actualDays.reduce((s, d) => s + (d.totalRevenue ?? 0), 0)
  const soldRooms = actualDays.reduce((s, d) => s + (d.soldRooms ?? 0), 0)
  const roomNights = hotel.totalRooms * actualDays.length

  const current = {
    adr: soldRooms > 0 ? Math.round(revenue / soldRooms) : null,
    occupancy: roomNights > 0 ? Math.round((soldRooms / roomNights) * 1000) / 1000 : null,
    revPar: roomNights > 0 ? Math.round(revenue / roomNights) : null,
    actualDays: actualDays.length,
  }

  const projected = {
    adr: simulation?.projectedAdr != null ? Math.round(simulation.projectedAdr) : null,
    occupancy:
      simulation?.projectedOccupancy != null
        ? Math.round(simulation.projectedOccupancy * 1000) / 1000
        : null,
    revPar: simulation?.projectedRevPar != null ? Math.round(simulation.projectedRevPar) : null,
    revenue: simulation?.projectedRevenue ?? null,
    rooms: simulation?.projectedRooms ?? null,
  }

  return { hotelId, year, month, current, projected, simulation, budget }
}
