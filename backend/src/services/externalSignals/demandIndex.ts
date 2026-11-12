import { prisma } from '../../lib/prisma.js'
import { config } from '../../lib/config.js'
import { addUtcDays, todayJst } from '../../lib/date.js'
import { holidaysKnownThrough } from '../../lib/jpHolidays.js'
import { TRAVEL_SEASON_LABELS, travelSeasonsOf, type TravelSeasonKey } from '../../lib/travelSeasons.js'
import { computeEventImpact, type EventImpactRecord } from '../forecast/eventImpact.js'
import { isInRanges, type DateRange } from '../forecast/pace.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'

// 月別需要指数（D-13。先方の資料「外部要因と旅行（宿泊）の関連付け」の「月別需要指数予測（100 が平均需要）」の材料）。
// 指数 = 季節（前年同月の稼働 ÷ 直近1年の平均稼働 × 100）＋ イベント ＋ 市場の動き。
//   - 季節: 前年同月の稼働が MIN_SEASON_DAYS 日以上ある月だけ。無ければ 100（平均）として扱い seasonal は null
//   - イベント: 月の日ごとのイベントの影響（稼働率の加算幅 — 需要予測と同じ値）の平均を、平均稼働に対する割合で足す
//   - 市場の動き: 外部要因エージェントが集めた期間の動き（high 5pt・medium 3pt・low 1pt の稼働率の増減の見立て）を、
//     月に重なる日数で按分して同じく足す。見立ての大きさは暫定値（クライアント確認待ち）
// 特殊日（予測の基準から外す期間）の実績は季節の計算に使わない。純関数 computeDemandIndex をテストで固定する。

export const MIN_SEASON_DAYS = 15
const SIGNAL_PT: Record<string, number> = { high: 0.05, medium: 0.03, low: 0.01 }
const SIGNAL_SIGN: Record<string, number> = { up: 1, down: -1, neutral: 0 }

export interface DemandIndexInput {
  months: Array<{ year: number; month: number }>
  /** 過去の稼働率（特殊日を除いたもの） */
  history: Array<{ date: Date; occupancy: number }>
  /** 直近1年の平均の基準日（この日より前の365日） */
  today: Date
  events: Array<EventImpactRecord & { name: string; source: string }>
  signals: Array<{ kind: string; title: string; periodStart: Date; periodEnd: Date; direction: string; magnitude: string }>
}

export interface DemandIndexMonth {
  year: number
  month: number
  index: number
  components: { seasonal: number | null; events: number; market: number }
  seasons: string[]
  events: Array<{ name: string; startDate: string; endDate: string; expectedImpact: string | null; source: string }>
  signals: Array<{ kind: string; title: string; direction: string; magnitude: string }>
}

const round1 = (v: number) => Math.round(v * 10) / 10
const iso = (d: Date) => d.toISOString().slice(0, 10)
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length

function daysOf(year: number, month: number): Date[] {
  const days: Date[] = []
  for (let d = new Date(Date.UTC(year, month - 1, 1)); d.getUTCMonth() === month - 1; d = addUtcDays(d, 1)) days.push(d)
  return days
}

export function computeDemandIndex(input: DemandIndexInput): DemandIndexMonth[] {
  const yearAgo = addUtcDays(input.today, -365)
  const lastYear = input.history.filter((h) => h.date >= yearAgo && h.date < input.today)
  const avgOcc = lastYear.length > 0 ? mean(lastYear.map((h) => h.occupancy)) : null

  return input.months.map(({ year, month }) => {
    const days = daysOf(year, month)
    const first = days[0]
    const last = days[days.length - 1]

    const prev = input.history.filter((h) => h.date.getUTCFullYear() === year - 1 && h.date.getUTCMonth() === month - 1)
    const seasonal = avgOcc && avgOcc > 0 && prev.length >= MIN_SEASON_DAYS ? round1((mean(prev.map((h) => h.occupancy)) / avgOcc) * 100) : null
    const base = avgOcc && avgOcc > 0 ? avgOcc : null

    const eventPt = mean(days.map((d) => computeEventImpact(input.events, d)))
    let marketPt = 0
    const monthSignals = input.signals.filter((s) => s.periodStart <= last && s.periodEnd >= first)
    for (const s of monthSignals) {
      const overlap = days.filter((d) => d >= s.periodStart && d <= s.periodEnd).length
      marketPt += (SIGNAL_PT[s.magnitude] ?? 0) * (SIGNAL_SIGN[s.direction] ?? 0) * (overlap / days.length)
    }
    const events = base ? round1((eventPt / base) * 100) : 0
    const market = base ? round1((marketPt / base) * 100) : 0

    const seasonKeys = new Set<TravelSeasonKey>(days.flatMap((d) => travelSeasonsOf(d)))
    return {
      year,
      month,
      index: round1((seasonal ?? 100) + events + market),
      components: { seasonal, events, market },
      seasons: [...seasonKeys].map((k) => TRAVEL_SEASON_LABELS[k]),
      events: input.events
        .filter((e) => e.startDate <= last && e.endDate >= first && e.expectedImpact)
        .map((e) => ({ name: e.name, startDate: iso(e.startDate), endDate: iso(e.endDate), expectedImpact: e.expectedImpact ?? null, source: e.source })),
      signals: monthSignals.map((s) => ({ kind: s.kind, title: s.title, direction: s.direction, magnitude: s.magnitude })),
    }
  })
}

/** GET /external-signals/demand-index: 今月から months か月分 */
export async function getDemandIndexService(hotelId: string, months: number) {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, isActive: true }, select: { id: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  const today = todayJst()
  const list = Array.from({ length: months }, (_, i) => {
    const offset = today.getUTCMonth() + i
    return { year: today.getUTCFullYear() + Math.floor(offset / 12), month: (offset % 12) + 1 }
  })
  const from = addUtcDays(today, -400)
  const until = new Date(Date.UTC(list[list.length - 1].year, list[list.length - 1].month, 0))
  const [daily, events, signals] = await Promise.all([
    prisma.dailyData.findMany({ where: { hotelId, date: { gte: from, lt: today } }, select: { date: true, occupancy: true } }),
    prisma.event.findMany({
      where: { hotelId, endDate: { gte: from }, startDate: { lte: until } },
      select: { name: true, startDate: true, endDate: true, expectedImpact: true, excludeFromHistory: true, source: true },
    }),
    prisma.marketSignal.findMany({
      where: { hotelId, periodEnd: { gte: today }, periodStart: { lte: until } },
      select: { kind: true, title: true, periodStart: true, periodEnd: true, direction: true, magnitude: true },
    }),
  ])
  const special: DateRange[] = events.filter((e) => e.excludeFromHistory)
  const history = daily
    .filter((d): d is { date: Date; occupancy: number } => d.occupancy != null && !isInRanges(d.date, special))
    .map((d) => ({ date: d.date, occupancy: d.occupancy }))
  return {
    months: computeDemandIndex({ months: list, history, today, events: events.filter((e) => !e.excludeFromHistory), signals }),
    /** 指数の作り方（画面の注記に使う） */
    basis: '100 = 直近1年の平均稼働。季節（前年同月）＋イベント＋市場の動きの見立て。市場の動きの大きさは暫定値',
  }
}

/** GET /external-signals/status: 外部要因の取得状況（天気・祝日・エージェント） */
export async function getExternalSignalsStatusService(hotelId: string) {
  const [weather, weatherDays, runs, agentEvents, signals] = await Promise.all([
    prisma.weatherForecast.findFirst({ where: { hotelId }, orderBy: { reportedAt: 'desc' }, select: { reportedAt: true, areaCode: true } }),
    prisma.weatherForecast.count({ where: { hotelId, date: { gte: todayJst() } } }),
    prisma.externalAgentRun.findMany({
      where: { hotelId },
      orderBy: { startedAt: 'desc' },
      take: 5,
      select: {
        startedAt: true,
        finishedAt: true,
        status: true,
        model: true,
        webSearches: true,
        eventsSaved: true,
        openingsSaved: true,
        signalsSaved: true,
        errorMessage: true,
      },
    }),
    prisma.event.count({ where: { hotelId, source: 'agent', endDate: { gte: todayJst() } } }),
    prisma.marketSignal.count({ where: { hotelId, periodEnd: { gte: todayJst() } } }),
  ])
  return {
    weather: weather ? { areaCode: weather.areaCode, reportedAt: weather.reportedAt.toISOString(), daysAhead: weatherDays } : null,
    holidays: { knownThrough: holidaysKnownThrough() },
    agent: {
      enabled: Boolean(config.ANTHROPIC_API_KEY),
      intervalDays: config.EXTERNAL_AGENT_INTERVAL_DAYS,
      upcomingAgentEvents: agentEvents,
      activeSignals: signals,
      recentRuns: runs.map((r) => ({ ...r, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null })),
    },
  }
}
