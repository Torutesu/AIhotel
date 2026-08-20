import type { ForecastVarianceReason } from '@prisma/client'

// AI予測とレベニュー担当予測の突き合わせ（F-DP-11 / F-DP-12）の計算ロジック。
// DBに触れない純粋関数だけを置き、サービス層から使う。

export interface ForecastMetrics {
  /** 稼働率 0-1 */
  occupancy: number | null
  adr: number | null
  soldRooms: number | null
  revenue: number | null
}

export interface VarianceThresholds {
  /** 稼働率の乖離幅（0.05 = 5pt） */
  occupancyPtThreshold: number
  /** ADRの乖離率（0.05 = 5%） */
  adrPctThreshold: number
  /** 売上の乖離率（0.10 = 10%） */
  revenuePctThreshold: number
}

export const DEFAULT_THRESHOLDS: VarianceThresholds = {
  occupancyPtThreshold: 0.05,
  adrPctThreshold: 0.05,
  revenuePctThreshold: 0.1,
}

export type VarianceMetricKey = 'occupancy' | 'adr' | 'revenue'

function round(value: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

/**
 * 部分入力から4指標を埋める。
 *
 * 担当者は「稼働率とADR」で考える人と「室数と売上」で考える人がいるため、
 * どちらの入り口でも同じ4指標に正規化する。総室数はホテルマスタの値を使う。
 * 明示的に入力された値は上書きしない（導出値より入力値を優先する）。
 */
export function deriveForecastMetrics(input: Partial<ForecastMetrics>, totalRooms: number): ForecastMetrics {
  let occupancy = input.occupancy ?? null
  let adr = input.adr ?? null
  let soldRooms = input.soldRooms ?? null
  let revenue = input.revenue ?? null

  if (totalRooms > 0) {
    if (occupancy == null && soldRooms != null) occupancy = round(soldRooms / totalRooms, 4)
    if (soldRooms == null && occupancy != null) soldRooms = Math.round(occupancy * totalRooms)
  }
  if (adr == null && revenue != null && soldRooms != null && soldRooms > 0) adr = round(revenue / soldRooms, 1)
  if (revenue == null && adr != null && soldRooms != null) revenue = round(adr * soldRooms, 0)

  return { occupancy, adr, soldRooms, revenue }
}

export interface ForecastVariance {
  /** 担当者 − AI（プラス = 担当者の方が強気） */
  occupancyDelta: number | null
  adrDelta: number | null
  adrDeltaPct: number | null
  soldRoomsDelta: number | null
  revenueDelta: number | null
  revenueDeltaPct: number | null
}

/**
 * AI予測と担当者予測の差異。基準（分母）はAI予測側に置く。
 */
export function computeForecastVariance(ai: ForecastMetrics, human: ForecastMetrics): ForecastVariance {
  const occupancyDelta =
    ai.occupancy != null && human.occupancy != null ? round(human.occupancy - ai.occupancy, 4) : null
  const adrDelta = ai.adr != null && human.adr != null ? round(human.adr - ai.adr, 1) : null
  const adrDeltaPct = adrDelta != null && ai.adr != null && ai.adr > 0 ? round(adrDelta / ai.adr, 4) : null
  const soldRoomsDelta =
    ai.soldRooms != null && human.soldRooms != null ? human.soldRooms - ai.soldRooms : null
  const revenueDelta = ai.revenue != null && human.revenue != null ? round(human.revenue - ai.revenue, 0) : null
  const revenueDeltaPct =
    revenueDelta != null && ai.revenue != null && ai.revenue > 0 ? round(revenueDelta / ai.revenue, 4) : null

  return { occupancyDelta, adrDelta, adrDeltaPct, soldRoomsDelta, revenueDelta, revenueDeltaPct }
}

/**
 * 意図・背景の記入を必須にすべき乖離かどうか。
 * どの指標が閾値を超えたかも返す（画面でどこがズレたかを示すため）。
 */
export function evaluateThreshold(
  variance: ForecastVariance,
  thresholds: VarianceThresholds
): { exceeded: boolean; breached: VarianceMetricKey[] } {
  const breached: VarianceMetricKey[] = []

  if (variance.occupancyDelta != null && Math.abs(variance.occupancyDelta) >= thresholds.occupancyPtThreshold) {
    breached.push('occupancy')
  }
  if (variance.adrDeltaPct != null && Math.abs(variance.adrDeltaPct) >= thresholds.adrPctThreshold) {
    breached.push('adr')
  }
  if (variance.revenueDeltaPct != null && Math.abs(variance.revenueDeltaPct) >= thresholds.revenuePctThreshold) {
    breached.push('revenue')
  }

  return { exceeded: breached.length > 0, breached }
}

export type CloserSide = 'AI' | 'OPERATOR' | 'TIE'

export interface AccuracyComparison {
  occupancy: CloserSide | null
  adr: CloserSide | null
  revenue: CloserSide | null
  /** 総合判定。売上で比べ、売上が無ければ稼働率で比べる */
  overall: CloserSide | null
}

function closerOf(actual: number | null, ai: number | null, human: number | null): CloserSide | null {
  if (actual == null || ai == null || human == null) return null
  const aiErr = Math.abs(actual - ai)
  const humanErr = Math.abs(actual - human)
  if (aiErr === humanErr) return 'TIE'
  return humanErr < aiErr ? 'OPERATOR' : 'AI'
}

/**
 * 実績に対して、AI予測と担当者予測のどちらが近かったかを指標ごとに判定する。
 * 実績が無い日（将来日・未取り込み）は null＝評価対象外。
 */
export function compareAccuracy(
  ai: ForecastMetrics,
  human: ForecastMetrics,
  actual: ForecastMetrics
): AccuracyComparison {
  const occupancy = closerOf(actual.occupancy, ai.occupancy, human.occupancy)
  const adr = closerOf(actual.adr, ai.adr, human.adr)
  const revenue = closerOf(actual.revenue, ai.revenue, human.revenue)
  return { occupancy, adr, revenue, overall: revenue ?? occupancy }
}

// ---- 集計 ----

export interface MetricTotals extends ForecastMetrics {
  days: number
}

/**
 * 日別の予測・実績を月次に積み上げる。
 * 稼働率は日平均ではなく「販売室数の合計 ÷ (総室数 × 日数)」、
 * ADRは「売上合計 ÷ 販売室数合計」で出す（日平均を取ると室数の重みが消えるため）。
 */
export function aggregateMetrics(entries: ForecastMetrics[], totalRooms: number): MetricTotals {
  const usable = entries.filter((e) => e.soldRooms != null || e.revenue != null)
  const soldRooms = usable.reduce((sum, e) => sum + (e.soldRooms ?? 0), 0)
  const revenue = usable.reduce((sum, e) => sum + (e.revenue ?? 0), 0)
  const days = usable.length

  return {
    days,
    soldRooms: days > 0 ? soldRooms : null,
    revenue: days > 0 ? revenue : null,
    occupancy: days > 0 && totalRooms > 0 ? round(soldRooms / (totalRooms * days), 4) : null,
    adr: soldRooms > 0 ? round(revenue / soldRooms, 1) : null,
  }
}

export interface ReasonBreakdown {
  key: ForecastVarianceReason
  count: number
  avgOccupancyDelta: number | null
  avgAdrDeltaPct: number | null
  avgRevenueDeltaPct: number | null
  /** 実績が判明した日のうち、担当者予測の方が近かった割合 */
  operatorCloserRate: number | null
  evaluatedCount: number
}

export interface ReasonSample {
  reason: ForecastVarianceReason
  variance: ForecastVariance
  accuracy: AccuracyComparison
}

function average(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v != null)
  if (nums.length === 0) return null
  return round(nums.reduce((a, b) => a + b, 0) / nums.length, 4)
}

/**
 * 「どういう背景のときに、どちら向きにどれだけズレ、結局どちらが当たったか」を
 * 意図・背景の分類ごとに集計する。差異の理由づけを検証可能にするための集計。
 */
export function analyzeByReason(samples: ReasonSample[]): ReasonBreakdown[] {
  const byReason = new Map<ForecastVarianceReason, ReasonSample[]>()
  for (const sample of samples) {
    const list = byReason.get(sample.reason) ?? []
    list.push(sample)
    byReason.set(sample.reason, list)
  }

  const result: ReasonBreakdown[] = []
  for (const [key, group] of byReason) {
    const evaluated = group.filter((s) => s.accuracy.overall != null)
    result.push({
      key,
      count: group.length,
      avgOccupancyDelta: average(group.map((s) => s.variance.occupancyDelta)),
      avgAdrDeltaPct: average(group.map((s) => s.variance.adrDeltaPct)),
      avgRevenueDeltaPct: average(group.map((s) => s.variance.revenueDeltaPct)),
      operatorCloserRate:
        evaluated.length > 0
          ? round(evaluated.filter((s) => s.accuracy.overall === 'OPERATOR').length / evaluated.length, 4)
          : null,
      evaluatedCount: evaluated.length,
    })
  }

  return result.sort((a, b) => b.count - a.count)
}

export const FORECAST_VARIANCE_REASON_LABELS: Record<ForecastVarianceReason, string> = {
  BOOKING_PACE: '予約の入り方',
  COMPETITOR_SUPPLY: '競合の供給・価格',
  EVENT_LOCAL: '地域イベント・催事',
  GROUP_CONTRACT: '団体・法人契約の確度',
  REPEAT_GUEST: '常連・リピーター動向',
  MARKET_TREND: '市況・季節性',
  OTA_CAMPAIGN: 'OTA施策の効き',
  RENOVATION_OPS: '改装・運営制約',
  DATA_DOUBT: 'AI予測の前提データに疑義',
  OTHER: 'その他',
}
