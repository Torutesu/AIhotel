// イベントの影響（需要予測の補正と、日の背景 — D-13 で ruleBasedForecaster.ts から分けた）。

// イベント影響度（pt = 稼働率への加算幅。0.15 = 15pt）
const EVENT_IMPACT_PT: Record<string, number> = {
  high: 0.15,
  medium: 0.08,
  low: 0.03,
}

export interface EventImpactRecord {
  startDate: Date
  endDate: Date
  expectedImpact?: string | null
}

/**
 * 期間内イベントの影響度合計（expectedImpact: high=+15pt / medium=+8pt / low=+3pt）
 */
export function computeEventImpact(events: EventImpactRecord[], targetDate: Date): number {
  let impact = 0
  for (const e of events) {
    if (targetDate >= e.startDate && targetDate <= e.endDate) {
      const key = (e.expectedImpact ?? '').toLowerCase()
      impact += EVENT_IMPACT_PT[key] ?? 0
    }
  }
  return impact
}

// 市場の動き（D-13。外部要因エージェントが集めたインバウンド・アクセス・季節の見通しなど、期間で効くもの）。
// 先方の判断（2026-11-12）で推奨ランクにも効かせる。1件あたり high 5pt・medium 3pt・low 1pt を上がる・下がるの向きで足し、
// 合計は ±MARKET_IMPACT_CAP までにする（エージェントの見立てで推奨が大きく振れないように）。月別需要指数と同じ大きさ
export const MARKET_SIGNAL_PT: Record<string, number> = { high: 0.05, medium: 0.03, low: 0.01 }
const MARKET_SIGN: Record<string, number> = { up: 1, down: -1, neutral: 0 }
export const MARKET_IMPACT_CAP = 0.06

export interface MarketSignalRecord {
  periodStart: Date
  periodEnd: Date
  direction: string
  magnitude: string
}

export function computeMarketImpact(signals: MarketSignalRecord[], targetDate: Date): { impact: number; count: number } {
  let impact = 0
  let count = 0
  for (const s of signals) {
    if (targetDate < s.periodStart || targetDate > s.periodEnd) continue
    const pt = (MARKET_SIGNAL_PT[s.magnitude] ?? 0) * (MARKET_SIGN[s.direction] ?? 0)
    if (pt !== 0) count++
    impact += pt
  }
  return { impact: Math.round(Math.max(-MARKET_IMPACT_CAP, Math.min(MARKET_IMPACT_CAP, impact)) * 1000) / 1000, count }
}
