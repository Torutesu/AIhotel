import type { Prisma } from '@prisma/client'
import { addUtcDays, todayJst } from '../../lib/date.js'
import { resolveCompetitorOccupancy } from '../forecast/strategyWeighting.js'
import type { DesiredAlert } from '../alertRulesService.js'
import type { RepresentativeChange } from './representative.js'

// 競合価格の変動の監視（#9 段階C）。
//
// 取得（job competitor-prices）や CSV の取り込みで代表値が変わったとき、見過ごすと価格判断に響く変化を
// アラートにする。対象は比較人数（#17 の competitorOccupancy）の料金。
// - 値下げ・値上げ: 前の代表値から MOVE_THRESHOLD 以上動いた
// - 満室: 前は販売していて、今回満室・販売停止になった（需要が強いシグナル）
// アラートは競合ごとに1回の取得で1件にまとめる（日付ごとに出すと一覧が埋まるため）。
// 閾値は #19（業務運用ルール）で確定するまでの暫定値。

/** 値下げ・値上げとみなす変化率 */
export const MOVE_THRESHOLD = 0.1
/** 監視する宿泊日の範囲（今日から何日先まで） */
export const MONITOR_DAYS_AHEAD = 60
/** この日数以内の宿泊日に変化があれば、ダッシュボードに出る Level 4 にする */
export const URGENT_DAYS_AHEAD = 14
/** メッセージに並べる日付の数 */
const MAX_LISTED_DATES = 5

export const RULE_COMPETITOR_MOVE = 'COMPETITOR_PRICE_MOVE'

export type PriceMoveKind = 'drop' | 'rise' | 'soldOut'

export interface PriceMove {
  competitorId: string
  stayDate: Date
  kind: PriceMoveKind
  before: number | null
  after: number | null
}

/** 代表値の変化から、知らせるべき変動を取り出す（純関数） */
export function detectPriceMoves(changes: RepresentativeChange[], occupancy: 1 | 2, today: Date): PriceMove[] {
  const end = addUtcDays(today, MONITOR_DAYS_AHEAD)
  const price = (v: RepresentativeChange['before']) => (occupancy === 2 ? v.price2P : v.price1P)
  const moves: PriceMove[] = []
  for (const c of changes) {
    if (c.stayDate < today || c.stayDate >= end) continue
    const before = price(c.before)
    const after = price(c.after)
    if (!c.before.soldOut && c.after.soldOut) {
      moves.push({ competitorId: c.competitorId, stayDate: c.stayDate, kind: 'soldOut', before, after: null })
      continue
    }
    if (c.before.soldOut || c.after.soldOut || before == null || after == null || before <= 0) continue
    const ratio = (after - before) / before
    if (Math.abs(ratio) < MOVE_THRESHOLD) continue
    moves.push({ competitorId: c.competitorId, stayDate: c.stayDate, kind: ratio < 0 ? 'drop' : 'rise', before, after })
  }
  return moves.sort((a, b) => a.stayDate.getTime() - b.stayDate.getTime())
}

const KIND_LABELS: Record<PriceMoveKind, string> = { drop: '値下げ', rise: '値上げ', soldOut: '満室' }

function describeMove(m: PriceMove): string {
  const date = `${m.stayDate.getUTCMonth() + 1}/${m.stayDate.getUTCDate()}`
  const yen = (v: number | null) => (v == null ? '—' : `¥${v.toLocaleString('ja-JP')}`)
  if (m.kind === 'soldOut') return `${date} 満室（${yen(m.before)}で販売中だった）`
  const pct = Math.round((((m.after as number) - (m.before as number)) / (m.before as number)) * 100)
  return `${date} ${yen(m.before)}→${yen(m.after)}（${pct > 0 ? '+' : ''}${pct}%）`
}

/**
 * 変動を競合ごとに1件のアラートにまとめる（純関数）。
 * ruleKey に検知日時を含めるので、取得のたびに新しいアラートになる（前回分は利用者が確認・解決する）
 */
export function buildPriceMoveAlerts(
  moves: PriceMove[],
  competitorNames: Map<string, string>,
  occupancy: 1 | 2,
  today: Date,
  now: Date
): DesiredAlert[] {
  const byCompetitor = new Map<string, PriceMove[]>()
  for (const m of moves) byCompetitor.set(m.competitorId, [...(byCompetitor.get(m.competitorId) ?? []), m])

  const urgentEnd = addUtcDays(today, URGENT_DAYS_AHEAD)
  const alerts: DesiredAlert[] = []
  for (const [competitorId, list] of byCompetitor) {
    const name = competitorNames.get(competitorId) ?? '競合'
    const counts = (['drop', 'rise', 'soldOut'] as const)
      .map((kind) => [kind, list.filter((m) => m.kind === kind).length] as const)
      .filter(([, n]) => n > 0)
      .map(([kind, n]) => `${KIND_LABELS[kind]}${n}日`)
    const urgent = list.some((m) => m.stayDate < urgentEnd)
    const listed = list.slice(0, MAX_LISTED_DATES).map(describeMove)
    const rest = list.length - listed.length
    alerts.push({
      ruleKey: `${RULE_COMPETITOR_MOVE}:${competitorId}:${now.toISOString()}`,
      severity: 'YELLOW',
      level: urgent ? 4 : 3,
      title: `競合「${name}」の価格が動きました（${counts.join('・')}）`,
      message:
        `${occupancy}名利用の料金の変化: ${listed.join('、')}${rest > 0 ? ` ほか${rest}日` : ''}。` +
        '推奨ランクへの影響を価格タブで確認してください。',
      linkTab: 'pricing',
      targetDate: list[0].stayDate,
    })
  }
  return alerts
}

/**
 * 代表値の変化を評価してアラートを作る（rebuildRepresentatives と同じトランザクションの中で呼ぶ）。
 * 作ったアラートの件数を返す
 */
export async function raisePriceMoveAlerts(
  tx: Prisma.TransactionClient,
  params: { hotelId: string; tenantId: string; changes: RepresentativeChange[]; now?: Date }
): Promise<number> {
  const { hotelId, tenantId, changes } = params
  if (changes.length === 0) return 0
  const now = params.now ?? new Date()
  const today = todayJst(now)

  const [hotel, strategy] = await Promise.all([
    tx.hotel.findUnique({ where: { id: hotelId }, select: { hotelType: true } }),
    tx.pricingStrategyConfig.findUnique({ where: { hotelId }, select: { competitorOccupancy: true } }),
  ])
  const occupancy = resolveCompetitorOccupancy(strategy?.competitorOccupancy, hotel?.hotelType)
  const moves = detectPriceMoves(changes, occupancy, today)
  if (moves.length === 0) return 0

  const competitors = await tx.competitor.findMany({
    where: { hotelId, id: { in: [...new Set(moves.map((m) => m.competitorId))] } },
    select: { id: true, name: true },
  })
  const alerts = buildPriceMoveAlerts(moves, new Map(competitors.map((c) => [c.id, c.name])), occupancy, today, now)
  await tx.alert.createMany({ data: alerts.map((a) => ({ ...a, hotelId, tenantId })) })
  return alerts.length
}
