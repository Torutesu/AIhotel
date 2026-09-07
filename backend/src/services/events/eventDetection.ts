// 前年の稼働残差スパイクからの年次イベント候補検出（docs/外部要因設計.md §3 #3 c）。DB 非依存。
//
// 各過去日について「同曜日の前後4週の平均 ＋ 祝日要因の初期値」を期待値とし、
// 実績との残差が閾値以上で、かつ登録済みイベントで説明できない日をスパイクとする。
// 連続するスパイク日は1つの候補にまとめ、翌年の候補日（同日／同曜日）を提案する。
import { computeHolidaySignal, holidayFactorKeys, toIsoDate } from '../signals/holidaySignal.js'
import { FACTOR_DEFAULTS } from '../forecast/factorDefaults.js'

export interface DetectionHistoryRecord {
  date: Date
  occupancy: number
}

export interface KnownEventRange {
  startDate: Date
  endDate: Date
}

export interface EventCandidate {
  /** スパイクが観測された期間（過去） */
  observedStart: Date
  observedEnd: Date
  /** 平均残差（pt） */
  avgResidualPt: number
  peakResidualPt: number
  /** 翌年の候補日: 同日（暦日）と同曜日（364日後） */
  suggestedSameDate: { start: Date; end: Date }
  suggestedSameWeekday: { start: Date; end: Date }
  suggestedImpact: 'high' | 'medium' | 'low'
}

export const SPIKE_THRESHOLD_PT = 0.15
const NEIGHBOR_WEEKS = 4

function addUtcDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

function addUtcYears(date: Date, years: number): Date {
  const d = new Date(date)
  d.setUTCFullYear(d.getUTCFullYear() + years)
  return d
}

function holidayExpectationPt(date: Date): number {
  const signal = computeHolidaySignal(date)
  if (!signal.known) return 0
  return holidayFactorKeys(signal).reduce((sum, key) => sum + (FACTOR_DEFAULTS[key] ?? 0), 0)
}

/**
 * 各日の残差（実績 − 期待値）を計算する。期待値が作れない日は除外
 */
export function computeResiduals(history: DetectionHistoryRecord[]): Array<{ date: Date; residualPt: number }> {
  const byDate = new Map(history.map((h) => [toIsoDate(h.date), h.occupancy]))
  const out: Array<{ date: Date; residualPt: number }> = []
  for (const h of history) {
    const neighbors: number[] = []
    for (let w = 1; w <= NEIGHBOR_WEEKS; w++) {
      for (const sign of [-1, 1]) {
        const v = byDate.get(toIsoDate(addUtcDays(h.date, sign * 7 * w)))
        if (v != null) neighbors.push(v)
      }
    }
    if (neighbors.length < 3) continue
    const sorted = [...neighbors].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const expected = Math.min(1, median + holidayExpectationPt(h.date))
    out.push({ date: h.date, residualPt: h.occupancy - expected })
  }
  return out
}

function coveredByKnownEvent(date: Date, events: KnownEventRange[]): boolean {
  return events.some((e) => date >= e.startDate && date <= e.endDate)
}

/**
 * スパイク日を連続区間にまとめて候補を返す
 */
export function detectEventCandidates(
  history: DetectionHistoryRecord[],
  knownEvents: KnownEventRange[],
  thresholdPt = SPIKE_THRESHOLD_PT
): EventCandidate[] {
  const residuals = computeResiduals(history)
    .filter((r) => r.residualPt >= thresholdPt && !coveredByKnownEvent(r.date, knownEvents))
    .sort((a, b) => a.date.getTime() - b.date.getTime())

  const candidates: EventCandidate[] = []
  let group: Array<{ date: Date; residualPt: number }> = []
  const flush = () => {
    if (group.length === 0) return
    const start = group[0].date
    const end = group[group.length - 1].date
    const avg = group.reduce((s, g) => s + g.residualPt, 0) / group.length
    const peak = Math.max(...group.map((g) => g.residualPt))
    candidates.push({
      observedStart: start,
      observedEnd: end,
      avgResidualPt: avg,
      peakResidualPt: peak,
      suggestedSameDate: { start: addUtcYears(start, 1), end: addUtcYears(end, 1) },
      suggestedSameWeekday: { start: addUtcDays(start, 364), end: addUtcDays(end, 364) },
      suggestedImpact: peak >= 0.3 ? 'high' : peak >= 0.2 ? 'medium' : 'low',
    })
    group = []
  }
  for (const r of residuals) {
    if (group.length > 0 && r.date.getTime() - group[group.length - 1].date.getTime() > 86_400_000) flush()
    group.push(r)
  }
  flush()
  return candidates
}
