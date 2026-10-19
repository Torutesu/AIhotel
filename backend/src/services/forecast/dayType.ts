// 日のタイプ（2026-10 デモ画面の修正 DP02 / DP03 / 分析03）。
//
// 「その日がどんな日か」を英字1文字＋数字1文字で表す（例: C3）。
//   英字 = 着地見込みの需要（A〜E）。着地見込み稼働率を、需要レベル（アラート）と同じ境目で格付けする
//          （A > 90%、B > 80%、C > 65%、D > 50%、それ以外 E）。
//          着地見込み = 今の予約室数 ＋ 前年同曜日がその残日数から最終までに伸びた室数（加算型ピックアップ法）。
//          前年と比べられない日は AI の予測稼働率を使う（予約済みの室数は下回らない）。
//   数字 = 前年同曜日と比べた予約の入り方（ペース）。今の予約室数 ÷ 前年同曜日の同じ残日数の予約室数で、
//          1 = 20%以上先行、2 = 5〜20%先行、3 = 前年並み（±5%未満）、4 = 5〜20%遅れ、5 = 20%以上遅れ。
//          前年の予約が少なすぎる・記録が無い日は数字を付けない（例: C）。
// アラートは AI の予測（曜日・イベント・競合を含む）、日のタイプは予約の実数から見た見込みなので、両者がずれる日は要確認の日になる。
// 残日数ごとに出し直せるため、90日前・30日前…と並べるとタイプの推移が見える（日のAI分析・予約期間別分析）。
// すべて DB 非依存の純関数にしてテストで固定する。

import { mapOccupancyToDemandLevel } from './ruleBasedForecaster.js'
import { leadDaysBetween, otbAtLead, PACE_MIN_LAST_YEAR_ROOMS, type BookingCurvePoint } from './pace.js'

export type DemandGrade = 'A' | 'B' | 'C' | 'D' | 'E'

/** 日のタイプの履歴を出す残日数（日のAI分析で「90日前 B3 → 30日前 C3 → 現在 C4」のように並べる） */
export const DAY_TYPE_HISTORY_LEADS = [90, 60, 30, 14, 7, 3, 1, 0] as const

export interface DayTypeInput {
  totalRooms: number
  /** その時点の予約室数（結果が出た日は販売室数） */
  otbRooms: number | null
  /** 前年同曜日の、同じ残日数での予約室数 */
  lastYearOtbRooms: number | null
  /** 前年同曜日の最終の販売室数 */
  lastYearFinalRooms: number | null
  /** 前年と比べられないときの着地見込み（AI の予測稼働率） */
  fallbackOccupancy?: number | null
}

export interface DayTypeResult {
  /** 例: "C3"。前年と比べられなければ英字だけ（"C"）。着地見込みが出せなければ null */
  dayType: string | null
  demandGrade: DemandGrade | null
  /** 1〜5。前年と比べられなければ null */
  paceGrade: number | null
  /** 着地見込み稼働率 */
  expectedOccupancy: number | null
  /** 今の予約室数 ÷ 前年同曜日の同じ残日数の予約室数（小数第2位まで） */
  paceRatio: number | null
}

/** ペース比を1〜5に格付けする。±5%未満を前年並み（3）とし、ちょうど ±5%・±20% は外側に入れる */
export function gradePace(ratio: number): number {
  if (ratio >= 1.2) return 1
  if (ratio >= 1.05) return 2
  if (ratio > 0.95) return 3
  if (ratio > 0.8) return 4
  return 5
}

const round3 = (v: number) => Math.round(v * 1000) / 1000

export function classifyDayType(input: DayTypeInput): DayTypeResult {
  const { totalRooms, otbRooms, lastYearOtbRooms, lastYearFinalRooms, fallbackOccupancy } = input
  if (totalRooms <= 0) return { dayType: null, demandGrade: null, paceGrade: null, expectedOccupancy: null, paceRatio: null }

  let paceRatio: number | null = null
  if (otbRooms != null && lastYearOtbRooms != null && lastYearOtbRooms >= PACE_MIN_LAST_YEAR_ROOMS) {
    paceRatio = otbRooms / lastYearOtbRooms
  }

  let expectedRooms: number | null = null
  if (otbRooms != null && lastYearOtbRooms != null && lastYearFinalRooms != null) {
    expectedRooms = otbRooms + Math.max(0, lastYearFinalRooms - lastYearOtbRooms)
  } else if (fallbackOccupancy != null) {
    expectedRooms = Math.max(otbRooms ?? 0, fallbackOccupancy * totalRooms)
  }

  if (expectedRooms == null) {
    return { dayType: null, demandGrade: null, paceGrade: null, expectedOccupancy: null, paceRatio: null }
  }

  const expectedOccupancy = round3(Math.min(1, expectedRooms / totalRooms))
  const demandGrade = mapOccupancyToDemandLevel(expectedOccupancy)
  const paceGrade = paceRatio == null ? null : gradePace(paceRatio)
  return {
    dayType: `${demandGrade}${paceGrade ?? ''}`,
    demandGrade,
    paceGrade,
    expectedOccupancy,
    paceRatio: paceRatio == null ? null : Math.round(paceRatio * 100) / 100,
  }
}

export interface DayTypeHistoryPoint {
  /** 宿泊日までの残日数（0 = 当日） */
  daysBefore: number
  dayType: string | null
  otbRooms: number | null
  paceRatio: number | null
}

export interface DayTypeTimeline {
  /** 今の日のタイプ。宿泊日を過ぎた日は結果（販売室数）で判定する */
  current: DayTypeResult
  /** 今より前の残日数ごとのタイプ（残日数の大きい順） */
  history: DayTypeHistoryPoint[]
}

export interface DayTypeTimelineInput {
  stayDate: Date
  today: Date
  totalRooms: number
  /** この宿泊日の予約積上 */
  points: BookingCurvePoint[]
  /** 前年同曜日の予約積上。前年同曜日が特殊日なら空で渡す */
  lastYearPoints: BookingCurvePoint[]
  /** 前年同曜日の販売室数。特殊日なら null で渡す */
  lastYearFinalRooms: number | null
  /** この日の販売室数（結果が出ていれば） */
  actualSoldRooms: number | null
  /** 今の AI の予測稼働率 */
  predictedOccupancy: number | null
}

/**
 * 1日ぶんの「今の日のタイプ」と、残日数ごとの推移を出す。
 * 前年同曜日の同じ残日数の予約が記録に無く、前年の結果だけがある残日数0は、結果どうしで比べる
 */
export function buildDayTypeTimeline(input: DayTypeTimelineInput): DayTypeTimeline {
  const { stayDate, today, totalRooms, points, lastYearPoints, lastYearFinalRooms, actualSoldRooms, predictedOccupancy } = input
  const currentLead = leadDaysBetween(today, stayDate)
  const lastYearAt = (lead: number) => otbAtLead(lastYearPoints, lead) ?? (lead === 0 ? lastYearFinalRooms : null)

  const history: DayTypeHistoryPoint[] = []
  for (const lead of DAY_TYPE_HISTORY_LEADS) {
    if (lead <= currentLead) continue
    const otbRooms = otbAtLead(points, lead) ?? (lead === 0 ? actualSoldRooms : null)
    const result = classifyDayType({
      totalRooms,
      otbRooms,
      lastYearOtbRooms: lastYearAt(lead),
      lastYearFinalRooms,
    })
    history.push({ daysBefore: lead, dayType: result.dayType, otbRooms, paceRatio: result.paceRatio })
  }

  let current: DayTypeResult
  if (currentLead < 0) {
    // 宿泊日を過ぎた日は結果で判定する（販売室数が無ければ当日の予約積上）
    const otbRooms = actualSoldRooms ?? otbAtLead(points, 0)
    current = classifyDayType({
      totalRooms,
      otbRooms,
      lastYearOtbRooms: lastYearAt(0),
      lastYearFinalRooms,
      fallbackOccupancy: otbRooms != null ? otbRooms / Math.max(1, totalRooms) : null,
    })
  } else {
    current = classifyDayType({
      totalRooms,
      otbRooms: otbAtLead(points, currentLead),
      lastYearOtbRooms: lastYearAt(currentLead),
      lastYearFinalRooms,
      fallbackOccupancy: predictedOccupancy,
    })
  }

  return { current, history }
}
