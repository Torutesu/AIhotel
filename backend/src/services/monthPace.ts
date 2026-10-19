// 月の予約の積み上がり（分析 > 日別パフォーマンスの「月のグラフ」— 2026-10 の画面修正 追加1019）。
//
// 月の各宿泊日について「宿泊日の N 日前の時点で何室入っていたか」を足し上げ、N = 180 → 0（結果）の推移にする。
// 日のグラフ（1日の 180日前 → 結果）を月全体に広げたもので、予算・AI の予測・前年同曜日と比べる。
//   - N 日前の時点の予約室数 = 残日数 N 以上で最も近い記録（その時点で取り込み済みだった最新の値）。結果（N = 0）は販売室数を優先する
//   - 月のどこかの日にその時点の記録が無ければ、その N は出さない（足し上げが欠けた値を見せない）
//   - 今月のように、まだ N 日前に達していない宿泊日がある N も出さない
//   - 前年比は、前年同曜日の記録がある日どうしだけで比べる（前年同曜日が特殊日の日は外す — 呼び出し側が渡さない）
// DB に触れない純関数にしてテストで固定する。

import type { BookingCurvePoint } from './forecast/pace.js'

export const MONTH_PACE_MAX_LEAD = 180

export interface MonthPaceDay {
  stayDate: Date
  /** この宿泊日の予約積上 */
  points: BookingCurvePoint[]
  /** 結果（販売室数） */
  actualSoldRooms: number | null
  /** 前年同曜日の予約積上と販売室数。前年同曜日が特殊日・記録なしなら null */
  lastYear: { points: BookingCurvePoint[]; finalRooms: number | null } | null
}

export interface MonthPacePoint {
  daysBefore: number
  /** 月の予約室数の合計（その時点） */
  rooms: number
  /** rooms ÷ (客室数 × 月の日数) */
  occupancy: number
  /** 前年同曜日の記録がある日だけの、今年と前年の予約室数の合計 */
  comparableRooms: number | null
  lastYearRooms: number | null
}

/** 残日数 lead の時点の予約室数。残日数 lead 以上で最も近い記録。記録が無ければ null */
export function roomsAsOf(points: BookingCurvePoint[], lead: number, finalRooms: number | null): number | null {
  if (lead === 0 && finalRooms != null) return finalRooms
  let best: BookingCurvePoint | null = null
  for (const p of points) {
    if (p.daysBefore < lead) continue
    if (!best || p.daysBefore < best.daysBefore) best = p
  }
  return best ? best.roomsBooked : null
}

export function buildMonthPace(params: {
  days: MonthPaceDay[]
  totalRooms: number
  today: Date
  maxLead?: number
}): MonthPacePoint[] {
  const { days, totalRooms, today, maxLead = MONTH_PACE_MAX_LEAD } = params
  if (days.length === 0 || totalRooms <= 0) return []
  const capacity = totalRooms * days.length
  // 月のすべての宿泊日が N 日前を過ぎている N だけを出す（N ≥ 月末 − 今日）
  const lastDay = days[days.length - 1].stayDate
  const minLead = Math.max(0, Math.round((lastDay.getTime() - today.getTime()) / 86_400_000))

  const result: MonthPacePoint[] = []
  for (let lead = maxLead; lead >= minLead; lead--) {
    let rooms = 0
    let complete = true
    let comparable = 0
    let lastYear = 0
    let comparableDays = 0
    for (const day of days) {
      const own = roomsAsOf(day.points, lead, day.actualSoldRooms)
      if (own == null) {
        complete = false
        break
      }
      rooms += own
      if (day.lastYear) {
        const ly = roomsAsOf(day.lastYear.points, lead, day.lastYear.finalRooms)
        if (ly != null) {
          comparable += own
          lastYear += ly
          comparableDays += 1
        }
      }
    }
    if (!complete) continue
    result.push({
      daysBefore: lead,
      rooms,
      occupancy: Math.round((rooms / capacity) * 1000) / 1000,
      comparableRooms: comparableDays > 0 ? comparable : null,
      lastYearRooms: comparableDays > 0 ? lastYear : null,
    })
  }
  return result
}
