// 日別パフォーマンスの差異の計算（2026-10 の画面修正。分析 > 実績推移 > 日別パフォーマンス）。
// 予算差異・AI想定差異 = 実績 − 予算（AI の予測）。稼働率は pt、ADR・REV-Per・室料売上は円。
// 前年比 = 前年同曜日（364日前）と比べる。稼働率は pt 差、ADR・REV-Per・室料売上は伸び率（%）。
// 画面から切り離した純関数にしてテストで固定する。

import type { BookingCurve, DailyPerformanceDay, DayMetrics } from "@/lib/api"

export type VarianceMetric = "occupancy" | "adr" | "revPar" | "revenue"

export const VARIANCE_METRICS: Array<{ key: VarianceMetric; label: string }> = [
  { key: "occupancy", label: "稼働率" },
  { key: "adr", label: "ADR" },
  { key: "revPar", label: "REV-Per" },
  { key: "revenue", label: "室料売上" },
]

export type VarianceSet = Record<VarianceMetric, number | null>

const EMPTY: VarianceSet = { occupancy: null, adr: null, revPar: null, revenue: null }

/** 実績 − 比べる相手。どちらかが欠けていれば null */
export function differenceOf(actual: DayMetrics | null, target: DayMetrics | null): VarianceSet {
  if (!actual || !target) return EMPTY
  const diff = (a: number | null, b: number | null) => (a == null || b == null ? null : a - b)
  return {
    occupancy: diff(actual.occupancy, target.occupancy),
    adr: diff(actual.adr, target.adr),
    revPar: diff(actual.revPar, target.revPar),
    revenue: diff(actual.revenue, target.revenue),
  }
}

/** 前年比。稼働率は pt 差、それ以外は 実績 ÷ 前年 − 1 */
export function yearOverYearOf(actual: DayMetrics | null, lastYear: DayMetrics | null): VarianceSet {
  if (!actual || !lastYear) return EMPTY
  const growth = (a: number | null, b: number | null) => (a == null || b == null || b === 0 ? null : a / b - 1)
  return {
    occupancy: actual.occupancy == null || lastYear.occupancy == null ? null : actual.occupancy - lastYear.occupancy,
    adr: growth(actual.adr, lastYear.adr),
    revPar: growth(actual.revPar, lastYear.revPar),
    revenue: growth(actual.revenue, lastYear.revenue),
  }
}

export interface VarianceRow {
  date: string
  day: number
  dow: number
  hasActual: boolean
  actual: DayMetrics | null
  budget: VarianceSet
  ai: VarianceSet
  yoy: VarianceSet
}

export function buildVarianceRows(days: DailyPerformanceDay[]): VarianceRow[] {
  return days.map((d) => {
    const [y, m, dd] = d.date.split("-").map(Number)
    return {
      date: d.date,
      day: dd,
      dow: new Date(y, m - 1, dd).getDay(),
      hasActual: d.actual != null,
      actual: d.actual,
      budget: differenceOf(d.actual, d.budget),
      ai: differenceOf(d.actual, d.ai),
      yoy: yearOverYearOf(d.actual, d.lastYear),
    }
  })
}

/** 指標を日ごとに足し上げた月の値（結果の出た日だけ。ADR = 売上 ÷ 室数、REV-Per = 売上 ÷ 客室数×日数） */
function totalOf(list: Array<DayMetrics | null>, totalRooms: number): DayMetrics | null {
  const valid = list.filter((m): m is DayMetrics => m != null)
  if (valid.length === 0) return null
  const rooms = valid.reduce((s, m) => s + (m.soldRooms ?? 0), 0)
  const revenue = valid.reduce((s, m) => s + (m.revenue ?? 0), 0)
  const capacity = totalRooms * valid.length
  return {
    soldRooms: rooms,
    occupancy: capacity > 0 ? rooms / capacity : null,
    adr: rooms > 0 ? revenue / rooms : null,
    revPar: capacity > 0 ? revenue / capacity : null,
    revenue,
  }
}

/** 月計: 結果の出た日だけで、実績と比べる相手を同じ日の集合で足し上げてから差を取る */
export function summarizeVariance(days: DailyPerformanceDay[], totalRooms: number) {
  const done = days.filter((d) => d.actual != null)
  const actual = totalOf(done.map((d) => d.actual), totalRooms)
  const pick = (f: (d: DailyPerformanceDay) => DayMetrics | null) => {
    const pairs = done.filter((d) => f(d) != null)
    return { actual: totalOf(pairs.map((d) => d.actual), totalRooms), target: totalOf(pairs.map(f), totalRooms) }
  }
  const budget = pick((d) => d.budget)
  const ai = pick((d) => d.ai)
  const lastYear = pick((d) => d.lastYear)
  return {
    days: done.length,
    actual,
    budget: differenceOf(budget.actual, budget.target),
    ai: differenceOf(ai.actual, ai.target),
    yoy: yearOverYearOf(lastYear.actual, lastYear.target),
  }
}

// ---- 日のグラフ（選んだ日の 180日前 → 結果）----

export interface DayPaceRow {
  daysBefore: number
  /** 予約（結果）の稼働率 − 予算稼働率（pt を 0〜1 の差で持つ） */
  budget: number | null
  /** 予約（結果）の稼働率 − AI の予測稼働率 */
  ai: number | null
  /** 予約室数 ÷ 前年同曜日の同じ残日数の予約室数 − 1 */
  yoy: number | null
}

export const DAY_PACE_MAX_LEAD = 180

/**
 * 選んだ宿泊日について、残日数ごとの「その時点の予約」と予算・AI・前年同曜日の差を並べる。
 * 予約の記録がある残日数だけ値が入る。結果の出た日は残日数0を結果（販売室数）にする
 */
export function buildDayPaceRows(curve: BookingCurve): DayPaceRow[] {
  const total = curve.totalRooms
  const own = new Map(curve.points.map((p) => [p.daysBefore, p.roomsBooked]))
  if (curve.actual?.soldRooms != null) own.set(0, curve.actual.soldRooms)
  const reference = new Map((curve.reference?.points ?? []).map((p) => [p.daysBefore, p.roomsBooked]))
  if (curve.reference?.finalRooms != null && !reference.has(0)) reference.set(0, curve.reference.finalRooms)
  const budgetOcc = curve.budget?.occupancy ?? null
  const aiOcc = curve.prediction?.occupancy ?? null
  const leads = [...own.keys()].filter((l) => l <= DAY_PACE_MAX_LEAD).sort((a, b) => b - a)
  return leads.map((lead) => {
    const rooms = own.get(lead) as number
    const occ = total > 0 ? rooms / total : null
    const ly = reference.get(lead)
    return {
      daysBefore: lead,
      budget: occ != null && budgetOcc != null ? occ - budgetOcc : null,
      ai: occ != null && aiOcc != null ? occ - aiOcc : null,
      yoy: ly != null && ly >= 3 ? rooms / ly - 1 : null,
    }
  })
}
