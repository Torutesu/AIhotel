// 会場情報からイベント影響度の初期値を推定する（docs/外部要因設計.md §3.1）。
//   影響 = 収容人数 ÷ ホテル客室数 × 距離減衰。来場者の一部（宿泊率）がエリアの客室を奪い合う、という近似。
//   実際の係数は event:high/medium/low として学習で補正される。

export type ImpactLevel = 'high' | 'medium' | 'low'

export interface ImpactEstimateInput {
  capacity: number | null | undefined
  distanceKm: number | null | undefined
  totalRooms: number
  /** イベント側で分かっていれば収容人数より優先 */
  expectedAttendance?: number | null
}

// 来場者のうち宿泊に回る割合（都市部の大規模公演の経験則。学習前の仮置き）
const STAY_RATIO = 0.05
// 距離減衰: 2km 以内は 1.0、10km で 0.3、20km で ≈0.1
export function distanceDecay(distanceKm: number | null | undefined): number {
  if (distanceKm == null) return 0.6 // 距離不明はやや割引
  if (distanceKm <= 2) return 1
  return Math.max(0.05, Math.exp(-(distanceKm - 2) / 6.5))
}

/**
 * 「イベント宿泊需要 ÷ ホテル客室数」を返す（1.0 = 客室数と同じだけの宿泊需要が発生）
 */
export function estimateDemandPressure(input: ImpactEstimateInput): number | null {
  const people = input.expectedAttendance ?? input.capacity
  if (people == null || people <= 0 || input.totalRooms <= 0) return null
  return (people * STAY_RATIO * distanceDecay(input.distanceKm)) / input.totalRooms
}

/**
 * 影響度ラベル。圧力 ≥ 1.0 → high、≥ 0.3 → medium、それ以外 low
 */
export function estimateEventImpact(input: ImpactEstimateInput): ImpactLevel | null {
  const pressure = estimateDemandPressure(input)
  if (pressure == null) return null
  if (pressure >= 1) return 'high'
  if (pressure >= 0.3) return 'medium'
  return 'low'
}
