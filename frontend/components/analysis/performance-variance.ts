// 日別パフォーマンスの差異の計算（2026-10 の画面修正。分析 > 実績推移 > 日別パフォーマンス）。
// 予算差異・AI想定差異 = 実績 − 予算（AI の予測）。稼働率は 0〜1 の差（画面は % 表記）、ADR・REV-Per・室料売上は円。
// 前年比 = 前年同曜日（364日前）と比べる。稼働率は差、ADR・REV-Per・室料売上は伸び率（%）。
// 「実数と想定値で見る」（PDF c分析01実績推移2）: 項目ごとに 実数（過去は実績、先の日は今の予約実数）・AI の想定・予算・予算差異を並べる。
// 画面から切り離した純関数にしてテストで固定する。

import type { BookingCurve, DailyPerformanceDay, DayMetrics, MonthPace } from "@/lib/api"

export type VarianceMetric = "occupancy" | "adr" | "revPar" | "revenue"

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

/**
 * 指標を日ごとに足し上げた月の値（ADR = 売上 ÷ 室数、REV-Per = 売上 ÷ 客室数×日数）。
 * 1日でも値の欠けた指標は出さない（欠けた日を 0 と数えると、予算未登録の月に差異が実績そのものになる）
 */
function totalOf(list: Array<DayMetrics | null>, totalRooms: number): DayMetrics | null {
  if (list.length === 0 || list.some((m) => m == null)) return null
  const valid = list as DayMetrics[]
  const sumOf = (pick: (m: DayMetrics) => number | null) =>
    valid.every((m) => pick(m) != null) ? valid.reduce((s, m) => s + (pick(m) as number), 0) : null
  const rooms = sumOf((m) => m.soldRooms)
  const revenue = sumOf((m) => m.revenue)
  const capacity = totalRooms * valid.length
  return {
    soldRooms: rooms,
    occupancy: rooms != null && capacity > 0 ? rooms / capacity : null,
    adr: rooms != null && revenue != null && rooms > 0 ? revenue / rooms : null,
    revPar: revenue != null && capacity > 0 ? revenue / capacity : null,
    revenue,
  }
}

/** 月計: 結果の出た日だけで、実績と比べる相手を同じ日の集合で足し上げてから差を取る */
export function summarizeVariance(days: DailyPerformanceDay[], totalRooms: number) {
  const done = days.filter((d) => d.actual != null)
  const actual = totalOf(done.map((d) => d.actual), totalRooms)
  const pick = (f: (d: DailyPerformanceDay) => DayMetrics | null) => {
    // 比べる相手の値がある日だけ（予算が未登録なら日割り予算の項目はすべて null）
    const pairs = done.filter((d) => {
      const target = f(d)
      return target != null && (target.soldRooms != null || target.revenue != null)
    })
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

// ---- 実数と想定値（PDF c分析01実績推移2: 販売室数・想定販売数、稼働率・想定稼働率…と並べ、予算・予算差異は想定値に並べる）----

export type FigureMetric = "soldRooms" | VarianceMetric

export const FIGURE_METRICS: FigureMetric[] = ["soldRooms", "occupancy", "adr", "revPar", "revenue"]

export interface FigureCell {
  /** 実数（過去は実績、先の日は今の予約実数。予約の単価・売上は PMS 連携後のため null） */
  value: number | null
  /** AI の想定 */
  ai: number | null
  budget: number | null
  /** 予算差異 = 結果（先の日は AI の想定）− 予算 */
  budgetDiff: number | null
}

export interface FigureRow {
  date: string
  day: number
  dow: number
  hasActual: boolean
  /** 予約実数の日（結果がまだで、今の予約の記録がある） */
  hasOnHand: boolean
  cells: Record<FigureMetric, FigureCell>
  yoy: VarianceSet
}

function figureCells(value: DayMetrics | null, ai: DayMetrics | null, budget: DayMetrics | null, landing: DayMetrics | null): Record<FigureMetric, FigureCell> {
  const cells = {} as Record<FigureMetric, FigureCell>
  for (const metric of FIGURE_METRICS) {
    const b = budget?.[metric] ?? null
    const l = landing?.[metric] ?? null
    cells[metric] = { value: value?.[metric] ?? null, ai: ai?.[metric] ?? null, budget: b, budgetDiff: l == null || b == null ? null : l - b }
  }
  return cells
}

export function buildFigureRows(days: DailyPerformanceDay[]): FigureRow[] {
  return days.map((d) => {
    const [y, m, dd] = d.date.split("-").map(Number)
    return {
      date: d.date,
      day: dd,
      dow: new Date(y, m - 1, dd).getDay(),
      hasActual: d.actual != null,
      hasOnHand: d.actual == null && d.onHand != null,
      cells: figureCells(d.actual ?? d.onHand, d.ai, d.budget, d.actual ?? d.ai),
      yoy: yearOverYearOf(d.actual, d.lastYear),
    }
  })
}

/**
 * 月計（実数と想定値）。実数の販売室数・稼働率は 実績＋予約（実績か予約の記録がある日で数える。バックエンドの曜日別と同じ）、
 * ADR・REV-Per・室料売上は結果の出た日だけ。想定・予算は月の全日、予算差異は 結果＋先の日の想定（着地の見込み）− 予算
 */
export function summarizeFigures(days: DailyPerformanceDay[], totalRooms: number) {
  const done = days.filter((d) => d.actual != null)
  const pending = days.filter((d) => d.actual == null && d.onHand?.soldRooms != null)
  const actualTotal = totalOf(done.map((d) => d.actual), totalRooms)
  const rooms = (actualTotal?.soldRooms ?? 0) + pending.reduce((a, d) => a + (d.onHand?.soldRooms ?? 0), 0)
  const countedDays = done.length + pending.length
  const value: DayMetrics = {
    soldRooms: countedDays > 0 ? rooms : null,
    occupancy: countedDays > 0 && totalRooms > 0 ? rooms / (totalRooms * countedDays) : null,
    adr: actualTotal?.adr ?? null,
    revPar: actualTotal?.revPar ?? null,
    revenue: actualTotal?.revenue ?? null,
  }
  const landing = totalOf(days.map((d) => d.actual ?? d.ai), totalRooms)
  const budget = totalOf(days.map((d) => d.budget), totalRooms)
  const ai = totalOf(days.map((d) => d.ai), totalRooms)
  const lastYear = done.filter((d) => d.lastYear != null)
  return {
    actualDays: done.length,
    onHandDays: pending.length,
    cells: figureCells(value, ai, budget, landing),
    yoy: yearOverYearOf(totalOf(lastYear.map((d) => d.actual), totalRooms), totalOf(lastYear.map((d) => d.lastYear), totalRooms)),
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

/**
 * 月のグラフ（月全体の 180日前 → 結果）。月の予約室数の合計を、予算・AI の予測の合計・前年同曜日の同じ時点と比べる。
 * 日のグラフと同じ形の行にする
 */
export function buildMonthPaceRows(pace: MonthPace): DayPaceRow[] {
  return pace.points.map((p) => ({
    daysBefore: p.daysBefore,
    budget: pace.budgetOccupancy != null ? p.occupancy - pace.budgetOccupancy : null,
    ai: pace.aiOccupancy != null ? p.occupancy - pace.aiOccupancy : null,
    yoy: p.comparableRooms != null && p.lastYearRooms != null && p.lastYearRooms >= 3 ? p.comparableRooms / p.lastYearRooms - 1 : null,
  }))
}
