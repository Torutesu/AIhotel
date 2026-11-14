import { prisma } from '../../lib/prisma.js'
import { addUtcDays, todayJst } from '../../lib/date.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'
import { TRAVEL_SEASON_LABELS, travelSeasonsOf } from '../../lib/travelSeasons.js'
import { JMA_ATTRIBUTION } from './jmaWeather.js'
import { MARKET_SIGNAL_PT } from '../forecast/eventImpact.js'
import { weatherClassOf } from '../dayTypeService.js'

// 外部需要動向の要因カードと週別の見通し（D-13 — 画面のサンプルを実データに置き換える）。
// - 要因: 気候（今後7日の天気の要約＋エージェントが集めた季節・災害・桜/紅葉の動き）、インバウンド、アクセス（市場の動き）
// - 週別: 今週から8週間、保存済みの需要予測の推奨理由（rationale）から「ベース＋イベントの効果＋市場の動きの効果＝予測稼働」を出す。
//   需要予測が天気を直接の補正に使っていないので、気候の効果は出さない

export type FactorCategory = 'climate' | 'inbound' | 'access'

export interface FactorRow {
  name: string
  /** positive = 需要に追い風、warning = 向かい風、normal = 中立 */
  status: 'positive' | 'warning' | 'normal'
  trend: 'up' | 'down' | 'neutral'
  note: string
  kpis: Array<{ label: string; value: string; hint?: string }>
  /** agent = 外部要因エージェント、jma = 気象庁 */
  source: 'agent' | 'jma'
  sourceUrl: string | null
}

const KIND_TO_CATEGORY: Record<string, FactorCategory> = {
  climate: 'climate',
  disaster: 'climate',
  nature: 'climate',
  inbound: 'inbound',
  access: 'access',
}
const MAGNITUDE_LABELS: Record<string, string> = { high: '大', medium: '中', low: '小' }
const md = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
const iso = (d: Date) => d.toISOString().slice(0, 10)

export async function getExternalFactorsService(hotelId: string) {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, isActive: true }, select: { id: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  const today = todayJst()
  // 今週の月曜から8週間
  const monday = addUtcDays(today, -((today.getUTCDay() + 6) % 7))
  const until = addUtcDays(monday, 8 * 7 - 1)

  const [signals, weather, recs, events] = await Promise.all([
    prisma.marketSignal.findMany({
      where: { hotelId, periodEnd: { gte: today } },
      orderBy: [{ periodStart: 'asc' }],
      select: { kind: true, title: true, summary: true, periodStart: true, periodEnd: true, direction: true, magnitude: true, sourceUrl: true },
    }),
    prisma.weatherForecast.findMany({
      where: { hotelId, date: { gte: today, lte: addUtcDays(today, 7) } },
      orderBy: { date: 'asc' },
      select: { date: true, weatherCode: true, pop: true, tempMax: true, tempMin: true, reportedAt: true },
    }),
    prisma.aiPriceRecommendation.findMany({
      where: { hotelId, roomTypeId: null, date: { gte: monday, lte: until } },
      select: { date: true, predictedOccupancy: true, rationale: true },
    }),
    prisma.event.findMany({
      where: { hotelId, excludeFromHistory: false, startDate: { lte: until }, endDate: { gte: monday } },
      orderBy: { startDate: 'asc' },
      select: { name: true, startDate: true, endDate: true, expectedImpact: true },
    }),
  ])

  const categories: Record<FactorCategory, FactorRow[]> = { climate: [], inbound: [], access: [] }

  if (weather.length > 0) {
    const rainy = weather.filter((w) => (weatherClassOf(w.weatherCode) ?? 1) >= 3).length
    const maxPop = Math.max(...weather.map((w) => w.pop ?? 0))
    const highs = weather.map((w) => w.tempMax).filter((v): v is number => v != null)
    categories.climate.push({
      name: '今後7日の天気',
      status: rainy >= 4 ? 'warning' : 'normal',
      trend: 'neutral',
      note:
        rainy === 0
          ? '雨・雪の予報はありません。日々の天気は宿泊への影響が小さいので、似た日の探索で弱く使っています'
          : `雨・雪の予報が ${rainy} 日あります。日々の天気は宿泊への影響が小さいので、似た日の探索で弱く使っています`,
      kpis: [
        { label: '雨・雪の日', value: `${rainy}日`, hint: `${md(weather[0].date)}〜${md(weather[weather.length - 1].date)}` },
        { label: '最大の降水確率', value: `${maxPop}%` },
        ...(highs.length > 0 ? [{ label: '最高気温', value: `${Math.min(...highs)}〜${Math.max(...highs)}°C` }] : []),
      ],
      source: 'jma',
      sourceUrl: null,
    })
  }

  for (const s of signals) {
    const category = KIND_TO_CATEGORY[s.kind]
    if (!category) continue
    const pt = Math.round((MARKET_SIGNAL_PT[s.magnitude] ?? 0) * 100)
    categories[category].push({
      name: s.title,
      status: s.direction === 'up' ? 'positive' : s.direction === 'down' ? 'warning' : 'normal',
      trend: s.direction === 'up' ? 'up' : s.direction === 'down' ? 'down' : 'neutral',
      note: s.summary,
      kpis: [
        { label: '期間', value: `${md(s.periodStart)}〜${md(s.periodEnd)}` },
        { label: '影響の大きさ', value: MAGNITUDE_LABELS[s.magnitude] ?? s.magnitude },
        ...(s.direction !== 'neutral' && pt > 0
          ? [{ label: '稼働率予測への補正', value: `${s.direction === 'up' ? '+' : '-'}${pt}pt`, hint: '重なる動きの合計は ±6pt まで' }]
          : []),
      ],
      source: 'agent',
      sourceUrl: s.sourceUrl,
    })
  }

  // 週別: 推奨理由の補正（event・market）を週で平均する
  type Adj = { key: string; impact: number }
  const weekly = Array.from({ length: 8 }, (_, w) => {
    const start = addUtcDays(monday, w * 7)
    const end = addUtcDays(start, 6)
    const days = recs.filter((r) => r.date >= start && r.date <= end && r.predictedOccupancy != null)
    const avg = (f: (r: (typeof days)[number]) => number) => (days.length === 0 ? null : days.reduce((a, r) => a + f(r), 0) / days.length)
    const impactOf = (r: (typeof days)[number], key: string) =>
      ((r.rationale as { adjustments?: Adj[] } | null)?.adjustments ?? []).filter((a) => a.key === key).reduce((a, x) => a + x.impact, 0)
    const total = avg((r) => r.predictedOccupancy as number)
    const event = avg((r) => impactOf(r, 'event'))
    const market = avg((r) => impactOf(r, 'market'))
    const weekEvents = events.filter((e) => e.startDate <= end && e.endDate >= start)
    const seasons = [...new Set(Array.from({ length: 7 }, (_, i) => travelSeasonsOf(addUtcDays(start, i))).flat())]
    const label = weekEvents[0]?.name ?? (seasons[0] ? TRAVEL_SEASON_LABELS[seasons[0]] : null)
    const pct = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 10)
    return {
      weekStart: iso(start),
      label,
      /** 予測稼働率（%）。推奨がまだ無い週は null */
      total: pct(total),
      event: pct(event),
      market: pct(market),
      base: total == null ? null : pct(total - (event ?? 0) - (market ?? 0)),
      events: weekEvents.map((e) => e.name),
    }
  })

  return {
    categories,
    weekly,
    weatherAttribution: weather.length > 0 ? JMA_ATTRIBUTION : null,
    /** 集めた市場の動きが無いときの案内に使う */
    hasAgentSignals: signals.length > 0,
  }
}
