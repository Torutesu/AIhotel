// 予約ペース（docs/外部要因設計.md §2.1 PaceFactor）。
//
// OTB（その時点の予約積上室数）を「同じリードタイムで通常どれだけ積み上がっているか」
// （典型積上率 f(lead)）で割って最終稼働率を投影する。典型積上率は過去の宿泊日の
// BookingCurveData（daysBefore=0 の最終値がある日）から算出し、サンプルが足りなければ
// デフォルト曲線を使う。PMS 連携（Phase 4）が入るまで OTB は BookingCurveData の
// 手入力/seed に依存する。

export interface CurvePoint {
  daysBefore: number
  fraction: number
}

/** 国内OTA中心のホテルの概ねの積上率（最終室数比）。学習・履歴で上書きされる前提の初期値 */
export const DEFAULT_BOOKING_CURVE: ReadonlyArray<CurvePoint> = [
  { daysBefore: 0, fraction: 1.0 },
  { daysBefore: 1, fraction: 0.92 },
  { daysBefore: 3, fraction: 0.82 },
  { daysBefore: 7, fraction: 0.65 },
  { daysBefore: 14, fraction: 0.48 },
  { daysBefore: 21, fraction: 0.38 },
  { daysBefore: 30, fraction: 0.3 },
  { daysBefore: 45, fraction: 0.2 },
  { daysBefore: 60, fraction: 0.13 },
  { daysBefore: 90, fraction: 0.06 },
]

const MIN_HISTORY_SAMPLES = 5
const MAX_PACE_PROJECTION = 1.2 // 投影稼働率の上限（clamp 前の値として保持し、価格反応モデルの潜在需要に使う）

/** 曲線を線形補間して daysBefore の典型積上率を返す */
export function typicalFraction(curve: ReadonlyArray<CurvePoint>, daysBefore: number): number {
  const pts = [...curve].sort((a, b) => a.daysBefore - b.daysBefore)
  if (daysBefore <= pts[0].daysBefore) return pts[0].fraction
  const last = pts[pts.length - 1]
  if (daysBefore >= last.daysBefore) return last.fraction
  for (let i = 1; i < pts.length; i++) {
    if (daysBefore <= pts[i].daysBefore) {
      const a = pts[i - 1]
      const b = pts[i]
      const t = (daysBefore - a.daysBefore) / (b.daysBefore - a.daysBefore)
      return a.fraction + (b.fraction - a.fraction) * t
    }
  }
  return last.fraction
}

export interface HistoricalCurveRecord {
  stayDate: Date
  daysBefore: number
  roomsBooked: number
}

/**
 * 過去の宿泊日（最終値 daysBefore=0 があるもの）から、リードタイム別の典型積上率曲線を作る。
 * 同曜日に絞って呼ぶことを想定。サンプルが MIN_HISTORY_SAMPLES 未満ならデフォルト曲線を返す
 */
export function buildCurveFromHistory(records: HistoricalCurveRecord[]): { curve: ReadonlyArray<CurvePoint>; samples: number } {
  const byStay = new Map<string, Map<number, number>>()
  for (const r of records) {
    const key = r.stayDate.toISOString().slice(0, 10)
    const m = byStay.get(key) ?? new Map<number, number>()
    m.set(r.daysBefore, r.roomsBooked)
    byStay.set(key, m)
  }
  const ratiosByLead = new Map<number, number[]>()
  let samples = 0
  for (const m of byStay.values()) {
    const final = m.get(0)
    if (!final || final <= 0) continue
    samples++
    for (const [lead, rooms] of m) {
      const list = ratiosByLead.get(lead) ?? []
      list.push(Math.min(1, rooms / final))
      ratiosByLead.set(lead, list)
    }
  }
  if (samples < MIN_HISTORY_SAMPLES) return { curve: DEFAULT_BOOKING_CURVE, samples }
  const curve: CurvePoint[] = []
  for (const [lead, list] of ratiosByLead) {
    const sorted = [...list].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    curve.push({ daysBefore: lead, fraction: median })
  }
  if (!curve.some((p) => p.daysBefore === 0)) curve.push({ daysBefore: 0, fraction: 1 })
  return { curve: curve.sort((a, b) => a.daysBefore - b.daysBefore), samples }
}

export interface PaceInput {
  roomsOnBooks: number
  daysBefore: number
  totalRooms: number
  curve: ReadonlyArray<CurvePoint>
}

/** OTB から最終稼働率を投影する（clamp なし・上限 MAX_PACE_PROJECTION） */
export function projectOccupancyFromPace(input: PaceInput): number {
  const f = Math.max(0.02, typicalFraction(input.curve, input.daysBefore))
  const projected = input.roomsOnBooks / (f * input.totalRooms)
  return Math.min(MAX_PACE_PROJECTION, Math.max(0, projected))
}
