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
