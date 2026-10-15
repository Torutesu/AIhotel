// 予約の入り方（ブッキングペース）と特殊日の扱い（D-11）。
//
// IDeaS などの運用では、販売開始後は「前年同週同曜日」のブッキングカーブと比べて想定外のペースになっていないかを見て、
// 悪ければ下げ、良すぎれば上げる。ここではそれを需要予測に組み込む:
//   - 前年同曜日（364日前）の同じ残日数の予約室数と、今の予約室数の比（ペース比）を出す
//   - 前年の最終の販売室数 × ペース比 を「ペースから見た着地」とし、残日数が短いほど強く予測に効かせる
//   - すでに予約が入っている室数より低い稼働率は予測しない（予約済みが下限）
// 年末年始・台風などの特殊日（Event.excludeFromHistory）の実績は、同曜日平均・前年比較・ペースの基準に使わない。
// すべて DB 非依存の純関数にしてテストで固定する。

const DAY_MS = 86_400_000

/** 前年同曜日の基準日（52週前 = 364日前）。曜日が揃うので週末・平日の並びが崩れない */
export const LAST_YEAR_OFFSET_DAYS = 364
/** ペース比の上下限。前年の予約が少ない日に比が暴れるのを抑える */
export const PACE_RATIO_MIN = 0.5
export const PACE_RATIO_MAX = 1.5
/** 前年の同じ残日数の予約がこれ未満なら比を出さない（1〜2室の差で比が大きく動くため） */
export const PACE_MIN_LAST_YEAR_ROOMS = 3
/** 予約積上の記録が残日数からこれ以上離れていたら使わない（古い・飛んでいる記録） */
export const PACE_MAX_CAPTURE_GAP_DAYS = 3

export interface DateRange {
  startDate: Date
  endDate: Date
}

/** 特殊日（予測の基準から外す期間）に入っている日か */
export function isInRanges(date: Date, ranges: DateRange[]): boolean {
  return ranges.some((r) => r.startDate <= date && date <= r.endDate)
}

/** 残日数に応じてペースを効かせる割合。宿泊日が近いほど、予約の入り方のほうが過去の平均より当たる */
export function paceWeight(leadDays: number): number {
  if (leadDays <= 14) return 0.6
  if (leadDays <= 30) return 0.5
  if (leadDays <= 60) return 0.35
  if (leadDays <= 120) return 0.2
  return 0
}

export interface PaceInput {
  /** 宿泊日までの残日数（0 = 当日） */
  leadDays: number
  /** 今の予約室数（直近の予約積上の記録）。記録が無ければ null */
  otbRooms: number | null
  /** 前年同曜日の、同じ残日数での予約室数 */
  lastYearOtbRooms: number | null
  /** 前年同曜日の最終の販売室数 */
  lastYearFinalRooms: number | null
  totalRooms: number
}

export interface PaceResult {
  /** 補正後の予測稼働率 */
  predicted: number
  /** 補正の量（補正後 − 補正前） */
  impact: number
  /** ペース比（今の予約 ÷ 前年の同じ残日数の予約。上下限で丸めた後）。比べられなければ null */
  ratio: number | null
  /** ペースから見た着地の稼働率。比べられなければ null */
  paceOccupancy: number | null
  weight: number
  /** 予約済み室数を下限にして予測を引き上げたか */
  otbFloorApplied: boolean
}

const round3 = (v: number) => Math.round(v * 1000) / 1000

/**
 * 予測稼働率にブッキングペースを反映する。
 * 1. 前年と比べられるときは「前年の最終販売 × ペース比」を残日数に応じた割合で混ぜる
 * 2. どんな場合も、すでに予約が入っている分（予約室数 ÷ 客室数）を下限にする
 */
export function applyPace(base: number, input: PaceInput): PaceResult {
  const { leadDays, otbRooms, lastYearOtbRooms, lastYearFinalRooms, totalRooms } = input
  let predicted = base
  let ratio: number | null = null
  let paceOccupancy: number | null = null
  const weight = paceWeight(leadDays)

  if (
    totalRooms > 0 &&
    otbRooms != null &&
    lastYearOtbRooms != null &&
    lastYearOtbRooms >= PACE_MIN_LAST_YEAR_ROOMS &&
    lastYearFinalRooms != null &&
    lastYearFinalRooms > 0 &&
    weight > 0
  ) {
    ratio = Math.min(PACE_RATIO_MAX, Math.max(PACE_RATIO_MIN, otbRooms / lastYearOtbRooms))
    paceOccupancy = Math.min(1, (lastYearFinalRooms * ratio) / totalRooms)
    predicted = base * (1 - weight) + paceOccupancy * weight
  }

  let otbFloorApplied = false
  if (totalRooms > 0 && otbRooms != null) {
    const floor = Math.min(1, otbRooms / totalRooms)
    if (predicted < floor) {
      predicted = floor
      otbFloorApplied = true
    }
  }

  predicted = round3(Math.min(1, Math.max(0, predicted)))
  return {
    predicted,
    impact: round3(predicted - base),
    ratio: ratio == null ? null : Math.round(ratio * 100) / 100,
    paceOccupancy: paceOccupancy == null ? null : round3(paceOccupancy),
    weight,
    otbFloorApplied,
  }
}

export interface BookingCurvePoint {
  stayDate: Date
  daysBefore: number
  roomsBooked: number
}

/**
 * 宿泊日ごとの予約積上から、残日数 leadDays 時点の予約室数を取る。
 * 残日数 leadDays 以上で最も近い記録（＝その時点までに取れていた最新の記録）を使い、
 * PACE_MAX_CAPTURE_GAP_DAYS より離れていれば null（古すぎて今の予約数とは言えない）
 */
export function otbAtLead(points: BookingCurvePoint[], leadDays: number): number | null {
  let best: BookingCurvePoint | null = null
  for (const p of points) {
    if (p.daysBefore < leadDays) continue
    if (!best || p.daysBefore < best.daysBefore) best = p
  }
  if (!best || best.daysBefore - leadDays > PACE_MAX_CAPTURE_GAP_DAYS) return null
  return best.roomsBooked
}

/** 前年同曜日の基準日 */
export function lastYearSameWeekday(date: Date): Date {
  return new Date(date.getTime() - LAST_YEAR_OFFSET_DAYS * DAY_MS)
}

/** 宿泊日までの残日数（日付どうしの差） */
export function leadDaysBetween(today: Date, stayDate: Date): number {
  return Math.round((stayDate.getTime() - today.getTime()) / DAY_MS)
}
