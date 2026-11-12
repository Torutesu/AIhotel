// 実績の少ないホテルの需要予測（D-13 — 新規開業・導入直後のコールドスタート）。
//
// 過去の実績が無いと、これまでの予測は固定の 60%（FALLBACK_OCCUPANCY）だった。代わりに次を使う:
//   1. ホテルタイプの典型的な予約の入り方（残日数ごとの「最終に対する予約の割合」）で、今の予約室数から着地を引き延ばす。
//      例: 宿泊特化で残14日に 40室・典型の割合 0.65 → 着地 62室
//   2. 予約の記録が無い日・割合が小さすぎる（遠い先の）日は、ホテルタイプの典型的な稼働率
// 典型の値は業界の一般的な傾向をもとにした暫定値（クライアント確認待ち — docs/改善計画.md D-13）。
// ホテル自身の実績が MIN_OWN_HISTORY_DAYS 日たまったら使わない（ホテルの実績で作る予測に任せる）。

import type { HotelType } from '@prisma/client'

export const MIN_OWN_HISTORY_DAYS = 28
/** 典型の割合がこれより小さい（遠い先）なら引き延ばさない（数室の差で着地が大きく振れるため） */
const MIN_SHARE_TO_EXTRAPOLATE = 0.2

type Curve = Array<[lead: number, share: number]>

/** ホテルタイプごとの典型的な予約の入り方（暫定値）。ビジネス寄りほど直前、リゾート・旅館ほど早い */
export const DEFAULT_CURVES: Record<HotelType, Curve> = {
  LIMITED_SERVICE: [[180, 0.05], [120, 0.1], [90, 0.15], [60, 0.25], [30, 0.45], [14, 0.65], [7, 0.8], [3, 0.9], [1, 0.96], [0, 1]],
  FULL_SERVICE: [[180, 0.1], [120, 0.18], [90, 0.25], [60, 0.35], [30, 0.55], [14, 0.72], [7, 0.85], [3, 0.93], [1, 0.97], [0, 1]],
  RESORT: [[180, 0.15], [120, 0.25], [90, 0.35], [60, 0.5], [30, 0.7], [14, 0.82], [7, 0.9], [3, 0.95], [1, 0.98], [0, 1]],
  RYOKAN: [[180, 0.15], [120, 0.25], [90, 0.35], [60, 0.5], [30, 0.7], [14, 0.82], [7, 0.9], [3, 0.95], [1, 0.98], [0, 1]],
}

/** ホテルタイプの典型的な稼働率（暫定値）。ホテルタイプが未設定なら null（これまでの 60% のまま） */
export const DEFAULT_OCCUPANCY: Record<HotelType, number> = {
  LIMITED_SERVICE: 0.78,
  FULL_SERVICE: 0.72,
  RESORT: 0.62,
  RYOKAN: 0.58,
}

/** 典型の割合（残日数の間は直線で補う。180日より先は 180日の値） */
export function defaultShareAt(hotelType: HotelType, lead: number): number {
  const curve = DEFAULT_CURVES[hotelType]
  if (lead >= curve[0][0]) return curve[0][1]
  for (let i = 0; i < curve.length - 1; i++) {
    const [farLead, farShare] = curve[i]
    const [nearLead, nearShare] = curve[i + 1]
    if (lead <= farLead && lead >= nearLead) {
      const t = (farLead - lead) / (farLead - nearLead)
      return farShare + (nearShare - farShare) * t
    }
  }
  return 1
}

export interface ColdStartInput {
  hotelType: HotelType | null
  lead: number
  otbRooms: number | null
  totalRooms: number
}

export interface ColdStartResult {
  occupancy: number
  /** extrapolated = 今の予約から引き延ばした、typical = ホテルタイプの典型の稼働率 */
  method: 'extrapolated' | 'typical'
  share: number | null
}

/** 実績の少ないホテルの基準の稼働率。ホテルタイプが未設定なら null（呼び出し側はこれまでの固定値を使う） */
export function coldStartOccupancy(input: ColdStartInput): ColdStartResult | null {
  const { hotelType, lead, otbRooms, totalRooms } = input
  if (!hotelType || totalRooms <= 0) return null
  const typical = DEFAULT_OCCUPANCY[hotelType]
  if (otbRooms != null && lead >= 0) {
    const share = defaultShareAt(hotelType, lead)
    if (share >= MIN_SHARE_TO_EXTRAPOLATE) {
      const extrapolated = Math.min(1, otbRooms / share / totalRooms)
      // 予約が多いほど引き延ばしを信じる（割合 0.2 で半々、1.0 で引き延ばしだけ）
      const w = Math.min(1, 0.5 + (share - MIN_SHARE_TO_EXTRAPOLATE) * 0.625)
      return { occupancy: Math.round((extrapolated * w + typical * (1 - w)) * 1000) / 1000, method: 'extrapolated', share: Math.round(share * 1000) / 1000 }
    }
  }
  return { occupancy: typical, method: 'typical', share: null }
}
