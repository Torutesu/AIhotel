import { prisma } from '../../lib/prisma.js'
import { addUtcDays, DEFAULT_WEEKEND_DAYS } from '../../lib/date.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'
import { loadBudgetStances } from '../budgetStance.js'
import { getDemandIndexService } from '../externalSignals/demandIndex.js'
import { travelSeasonsOf, TRAVEL_SEASON_LABELS } from '../../lib/travelSeasons.js'

// AI 解説の材料（D-13）。Claude に渡す「事実の束」を DB から決まった形で作る。
// 文章の中の数字は、ここに入れた値からしか使わせない（作文の段階で数字を作らせない）。純粋な読み出しだけで、書き込まない。

const iso = (d: Date) => d.toISOString().slice(0, 10)
const pct = (v: number | null | undefined) => (v == null ? null : Math.round(v * 1000) / 10)

export interface MonthFact {
  month: string
  budgetRevenue: number | null
  projectedRevenue: number | null
  /** 着地見込み ÷ 予算（%） */
  achievementPct: number | null
  projectedOccupancyPct: number | null
  /** onTrack / chase / giveUp（3か月より先・予算の無い月は null） */
  budgetStance: string | null
  demandIndex: number | null
  seasons: string[]
}

export interface HotelFacts {
  hotelName: string
  totalRooms: number
  today: string
  weekendDays: number[]
  months: MonthFact[]
  /** 今日から30日の推奨（予測稼働率・推奨ランク・需要レベル・日のタイプ・補正） */
  next30Days: Array<{ date: string; weekday: string; predictedOccupancyPct: number | null; demandLevel: string | null; recommendedRank: number | null; dayType: string | null; drivers: string[] }>
  alerts: Array<{ level: number; title: string; message: string; targetDate: string | null }>
  marketSignals: Array<{ kind: string; title: string; summary: string; period: string; direction: string; magnitude: string }>
  events: Array<{ name: string; period: string; impact: string | null; source: string }>
  newHotelOpenings: Array<{ name: string; openingDate: string; rooms: number | null }>
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']
const ADJUSTMENT_NAMES: Record<string, string> = {
  event: 'イベント',
  pace: '前年より予約が速い・遅い',
  otbFloor: '予約済みの室数',
  pattern: '似た日の着地',
  market: '市場の動き',
  coldStart: '実績が少ない',
}

export async function buildHotelFacts(hotelId: string, today: Date): Promise<HotelFacts> {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, isActive: true }, select: { name: true, totalRooms: true, weekendDays: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  const months = Array.from({ length: 3 }, (_, i) => {
    const offset = today.getUTCMonth() + i
    return { year: today.getUTCFullYear() + Math.floor(offset / 12), month: (offset % 12) + 1 }
  })
  const until30 = addUtcDays(today, 29)

  const [budgets, landings, stances, demand, recs, alerts, signals, events, openings] = await Promise.all([
    prisma.monthlyBudget.findMany({ where: { hotelId, OR: months }, select: { year: true, month: true, budgetRevenue: true, budgetRooms: true, budgetAdr: true } }),
    prisma.monthlyLandingSimulation.findMany({ where: { hotelId, OR: months }, select: { year: true, month: true, projectedRevenue: true, projectedOccupancy: true } }),
    loadBudgetStances(hotelId, months, today),
    getDemandIndexService(hotelId, 3),
    prisma.aiPriceRecommendation.findMany({
      where: { hotelId, roomTypeId: null, date: { gte: today, lte: until30 } },
      orderBy: { date: 'asc' },
      select: { date: true, predictedOccupancy: true, demandLevel: true, recommendedRank: true, rationale: true },
    }),
    prisma.alert.findMany({
      where: { hotelId, status: { not: 'RESOLVED' }, level: { gte: 3 } },
      orderBy: [{ level: 'desc' }, { detectedAt: 'desc' }],
      take: 8,
      select: { level: true, title: true, message: true, targetDate: true },
    }),
    prisma.marketSignal.findMany({
      where: { hotelId, periodEnd: { gte: today } },
      orderBy: { periodStart: 'asc' },
      take: 10,
      select: { kind: true, title: true, summary: true, periodStart: true, periodEnd: true, direction: true, magnitude: true },
    }),
    prisma.event.findMany({
      where: { hotelId, excludeFromHistory: false, endDate: { gte: today }, startDate: { lte: addUtcDays(today, 90) } },
      orderBy: { startDate: 'asc' },
      take: 10,
      select: { name: true, startDate: true, endDate: true, expectedImpact: true, source: true },
    }),
    prisma.newHotelOpening.findMany({
      where: { hotelId, openingDate: { gte: today, lte: addUtcDays(today, 180) } },
      orderBy: { openingDate: 'asc' },
      take: 5,
      select: { name: true, openingDate: true, rooms: true },
    }),
  ])

  const monthFacts: MonthFact[] = months.map(({ year, month }) => {
    const b = budgets.find((x) => x.year === year && x.month === month)
    const l = landings.find((x) => x.year === year && x.month === month)
    const budgetRevenue = b?.budgetRevenue ?? (b?.budgetRooms != null && b.budgetAdr != null ? b.budgetRooms * b.budgetAdr : null)
    const projectedRevenue = l?.projectedRevenue ?? null
    const d = demand.months.find((x) => x.year === year && x.month === month)
    return {
      month: `${year}年${month}月`,
      budgetRevenue: budgetRevenue == null ? null : Math.round(budgetRevenue),
      projectedRevenue: projectedRevenue == null ? null : Math.round(projectedRevenue),
      achievementPct: budgetRevenue && projectedRevenue != null ? Math.round((projectedRevenue / budgetRevenue) * 1000) / 10 : null,
      projectedOccupancyPct: pct(l?.projectedOccupancy),
      budgetStance: stances.get(`${year}-${month}`)?.stance ?? null,
      demandIndex: d?.index ?? null,
      seasons: d?.seasons ?? [],
    }
  })

  type Rationale = { adjustments?: Array<{ key: string; impact: number }>; dayType?: { name: string | null } }
  const next30Days = recs.map((r) => {
    const rationale = r.rationale as Rationale | null
    const drivers = (rationale?.adjustments ?? [])
      .filter((a) => Math.abs(a.impact) >= 0.02 && ADJUSTMENT_NAMES[a.key])
      .map((a) => `${ADJUSTMENT_NAMES[a.key]} ${a.impact > 0 ? '+' : ''}${Math.round(a.impact * 100)}pt`)
    const seasons = travelSeasonsOf(r.date).map((k) => TRAVEL_SEASON_LABELS[k])
    return {
      date: iso(r.date),
      weekday: WEEKDAYS[r.date.getUTCDay()],
      predictedOccupancyPct: pct(r.predictedOccupancy),
      demandLevel: r.demandLevel,
      recommendedRank: r.recommendedRank,
      dayType: rationale?.dayType?.name ?? null,
      drivers: [...drivers, ...seasons],
    }
  })

  const period = (a: Date, b: Date) => (iso(a) === iso(b) ? iso(a) : `${iso(a)}〜${iso(b)}`)
  return {
    hotelName: hotel.name,
    totalRooms: hotel.totalRooms,
    today: iso(today),
    weekendDays: Array.isArray(hotel.weekendDays) ? (hotel.weekendDays as number[]) : [...DEFAULT_WEEKEND_DAYS],
    months: monthFacts,
    next30Days,
    alerts: alerts.map((a) => ({ level: a.level, title: a.title, message: a.message, targetDate: a.targetDate ? iso(a.targetDate) : null })),
    marketSignals: signals.map((s) => ({ kind: s.kind, title: s.title, summary: s.summary, period: period(s.periodStart, s.periodEnd), direction: s.direction, magnitude: s.magnitude })),
    events: events.map((e) => ({ name: e.name, period: period(e.startDate, e.endDate), impact: e.expectedImpact, source: e.source })),
    newHotelOpenings: openings.map((o) => ({ name: o.name, openingDate: iso(o.openingDate), rooms: o.rooms })),
  }
}
