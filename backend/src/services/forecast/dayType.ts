// 日のタイプ（日のモデル — 2026-10 の画面修正。PDF b01・b02・b03・c分析01実績推移2、xlsx DP02・DP03・分析03）。
//
// 先方の指示: 「平日A型・平日B型・週末A型・特日A型…のように日を分類する。種類の数と構成は AI に判断させる」
// 「稼働と単価のどちらを優先するかは日の分類で AI が割り当て、販売の進み方で最適なモデルに変える」
// 「日のタイプはリードタイムで変わるので履歴も出す」「周辺日は日のタイプが同じ傾向の日を参考に出す」。
// ここでは次のように分ける（DB 非依存の純関数。データの読み込みは services/dayTypeService.ts）:
//   1. 日の区分: 特日（祝日・お盆・年末年始・GW、特殊日のイベント）／週末（Hotel.weekendDays）／平日
//   2. 区分ごとに、過去の結果（最終の稼働率）を自然な切れ目で 1〜4 群に分ける（Jenks の自然分類。群の数はデータで決める）。
//      稼働の高い群から A・B・C・D 型（例: 平日A型）
//   3. 型ごとに、典型的なブッキングカーブ（残日数ごとの「最終に対する予約の割合」の中央値）と優先モデルを持つ
//      （平均稼働 85%以上 = 単価優先、65%以下 = 稼働優先、その間 = バランス）
//   4. 先の日は、今の予約室数が型の典型カーブ（その残日数での予約室数）のどれに近いかで型を決める。
//      予約が進むと型が変わり、優先モデルも変わる（＝販売の進み方で最適なモデルに変える）。
//      予約の記録が無ければ AI の予測稼働率、結果の出た日は最終の稼働率で決める

import { otbAtLead, leadDaysBetween, type BookingCurvePoint } from './pace.js'

export type DayCategory = 'weekday' | 'weekend' | 'special'
export const DAY_CATEGORY_LABELS: Record<DayCategory, string> = { weekday: '平日', weekend: '週末', special: '特日' }

/** 稼働と単価のどちらを優先して価格を決めるか */
export type DayModel = 'occupancy' | 'balanced' | 'adr'
export const DAY_MODEL_LABELS: Record<DayModel, string> = { occupancy: '稼働優先', balanced: 'バランス', adr: '単価優先' }

/** 型の数の上限（A〜D） */
export const MAX_DAY_TYPES = 4
/** 1つの型に必要な日数。これより小さい群には分けない */
export const MIN_DAYS_PER_TYPE = 5
/** 群に分けたときの説明力（GVF）がこれ以上なら、それ以上は分けない */
export const GOOD_FIT_GVF = 0.8
/** 稼働率のばらつき（標準偏差）がこれ未満なら分けない（どの日も同じような日） */
export const MIN_OCCUPANCY_SPREAD = 0.03
/** 平均の稼働がこれ以上の型は単価優先、これ以下の型は稼働優先 */
export const ADR_PRIORITY_OCCUPANCY = 0.85
export const OCCUPANCY_PRIORITY_OCCUPANCY = 0.65
/** 典型カーブを出す残日数（予約積上を取り込む残日数とそろえる） */
export const CURVE_GRID_LEADS = [180, 120, 90, 60, 45, 30, 21, 14, 7, 3, 1, 0] as const
/** 典型カーブの1点に必要な日数 */
const MIN_CURVE_SAMPLES = 3
/** 日のタイプの履歴を出す残日数（日のAI分析で「90日前 平日B型 → 現在 平日A型」のように並べる） */
export const DAY_TYPE_HISTORY_LEADS = [90, 60, 30, 14, 7, 3, 1, 0] as const

/** 型を作る材料になる過去の1日 */
export interface DayTypeHistoryDay {
  date: Date
  category: DayCategory
  /** 最終の稼働率（0〜1） */
  occupancy: number
  adr: number | null
  /** 最終の販売室数 */
  finalRooms: number
  /** その宿泊日の予約積上（無ければ空） */
  points: BookingCurvePoint[]
}

export interface DayTypeProfile {
  /** 例: "weekday-A" */
  id: string
  /** 例: "平日A型" */
  name: string
  category: DayCategory
  letter: string
  /** 型に入った過去の日数 */
  days: number
  /** 平均の最終稼働率 */
  avgOccupancy: number
  /** 型に入る稼働率の範囲（過去の日の最小・最大） */
  minOccupancy: number
  maxOccupancy: number
  avgAdr: number | null
  model: DayModel
  /** 典型カーブ: 残日数ごとの「最終に対する予約の割合」の中央値。日数が足りない残日数は含めない */
  curveShare: Array<{ daysBefore: number; share: number }>
}

const round3 = (v: number) => Math.round(v * 1000) / 1000
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)
const mean = (values: number[]) => sum(values) / values.length
const sse = (values: number[]) => {
  if (values.length === 0) return 0
  const m = mean(values)
  return sum(values.map((v) => (v - m) ** 2))
}
const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * 並べた値を k 群に分ける（Jenks の自然分類: 群の中のばらつきの合計が最小になる切れ目を動的計画法で探す）。
 * 戻り値は小さい値の群から順
 */
export function naturalBreaks(sorted: number[], k: number): number[][] {
  const n = sorted.length
  if (k <= 1 || n <= k) return k <= 1 || n === 0 ? [sorted] : sorted.map((v) => [v])
  // prefix sums で区間の SSE を O(1) で出す
  const ps = [0]
  const ps2 = [0]
  for (const v of sorted) {
    ps.push(ps[ps.length - 1] + v)
    ps2.push(ps2[ps2.length - 1] + v * v)
  }
  const cost = (i: number, j: number) => {
    // [i, j) の SSE
    const cnt = j - i
    const s = ps[j] - ps[i]
    return ps2[j] - ps2[i] - (s * s) / cnt
  }
  // dp[c][j] = 先頭 j 個を c 群に分けた最小 SSE
  const dp: number[][] = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(Infinity))
  const cut: number[][] = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(0))
  dp[0][0] = 0
  for (let c = 1; c <= k; c++) {
    for (let j = c; j <= n; j++) {
      for (let i = c - 1; i < j; i++) {
        const v = dp[c - 1][i] + cost(i, j)
        if (v < dp[c][j]) {
          dp[c][j] = v
          cut[c][j] = i
        }
      }
    }
  }
  const classes: number[][] = []
  let j = n
  for (let c = k; c >= 1; c--) {
    const i = cut[c][j]
    classes.unshift(sorted.slice(i, j))
    j = i
  }
  return classes
}

/**
 * 1つの区分の稼働率を群に分ける。群の数は 1〜MAX_DAY_TYPES の中で、
 * 説明力が GOOD_FIT_GVF に届いた最小の数（どの群も MIN_DAYS_PER_TYPE 日以上）
 */
export function chooseOccupancyClasses(values: number[]): number[][] {
  if (values.length === 0) return []
  const sorted = [...values].sort((a, b) => a - b)
  const total = sse(sorted)
  if (sorted.length < MIN_DAYS_PER_TYPE * 2 || Math.sqrt(total / sorted.length) < MIN_OCCUPANCY_SPREAD) return [sorted]
  let best: number[][] = [sorted]
  for (let k = 2; k <= MAX_DAY_TYPES; k++) {
    const classes = naturalBreaks(sorted, k)
    if (classes.some((c) => c.length < MIN_DAYS_PER_TYPE)) break
    best = classes
    const fit = 1 - sum(classes.map(sse)) / total
    if (fit >= GOOD_FIT_GVF) break
  }
  return best
}

export function modelForOccupancy(avgOccupancy: number): DayModel {
  if (avgOccupancy >= ADR_PRIORITY_OCCUPANCY) return 'adr'
  if (avgOccupancy <= OCCUPANCY_PRIORITY_OCCUPANCY) return 'occupancy'
  return 'balanced'
}

/** 型の典型カーブ（残日数ごとの「最終に対する予約の割合」の中央値） */
function buildCurveShare(members: DayTypeHistoryDay[]): DayTypeProfile['curveShare'] {
  const result: DayTypeProfile['curveShare'] = []
  for (const lead of CURVE_GRID_LEADS) {
    const shares: number[] = []
    for (const day of members) {
      if (day.finalRooms <= 0 || day.points.length === 0) continue
      const booked = otbAtLead(day.points, lead)
      if (booked != null) shares.push(Math.min(1, booked / day.finalRooms))
    }
    if (shares.length >= MIN_CURVE_SAMPLES) result.push({ daysBefore: lead, share: round3(median(shares)) })
  }
  return result
}

/** 過去の日から、区分ごとの型を作る。区分ごとに稼働の高い群から A・B・C・D */
export function buildDayTypes(history: DayTypeHistoryDay[]): DayTypeProfile[] {
  const profiles: DayTypeProfile[] = []
  for (const category of ['weekday', 'weekend', 'special'] as const) {
    const days = history.filter((d) => d.category === category)
    const classes = chooseOccupancyClasses(days.map((d) => d.occupancy))
    if (classes.length === 0 || days.length < MIN_DAYS_PER_TYPE) continue
    // 稼働の高い群から A
    const ordered = [...classes].reverse()
    const bounds = ordered.map((c) => ({ min: c[0], max: c[c.length - 1] }))
    ordered.forEach((values, index) => {
      const letter = String.fromCharCode(65 + index)
      const { min, max } = bounds[index]
      // 同じ値が群の境目をまたぐことはない（自然分類は並べた値を切る）が、値の重複に備えて範囲で振り分ける
      const members = days.filter((d) => d.occupancy >= min && d.occupancy <= max)
      const adrs = members.map((d) => d.adr).filter((v): v is number => v != null)
      const avgOccupancy = round3(mean(values))
      profiles.push({
        id: `${category}-${letter}`,
        name: `${DAY_CATEGORY_LABELS[category]}${letter}型`,
        category,
        letter,
        days: values.length,
        avgOccupancy,
        minOccupancy: round3(min),
        maxOccupancy: round3(max),
        avgAdr: adrs.length > 0 ? Math.round(mean(adrs)) : null,
        model: modelForOccupancy(avgOccupancy),
        curveShare: buildCurveShare(members),
      })
    })
  }
  return profiles
}

/** 典型カーブの残日数 lead での割合（記録のある残日数の間は直線で補う）。範囲外・記録なしは null */
export function shareAtLead(profile: DayTypeProfile, lead: number): number | null {
  const points = profile.curveShare
  if (points.length === 0) return null
  const exact = points.find((p) => p.daysBefore === lead)
  if (exact) return exact.share
  // curveShare は残日数の大きい順
  for (let i = 0; i < points.length - 1; i++) {
    const far = points[i]
    const near = points[i + 1]
    if (far.daysBefore > lead && lead > near.daysBefore) {
      const t = (far.daysBefore - lead) / (far.daysBefore - near.daysBefore)
      return round3(far.share + (near.share - far.share) * t)
    }
  }
  return null
}

const nearestByOccupancy = (types: DayTypeProfile[], occupancy: number) =>
  types.reduce((best, t) => (Math.abs(t.avgOccupancy - occupancy) < Math.abs(best.avgOccupancy - occupancy) ? t : best))

export interface ClassifyDayInput {
  /** その日の区分の型（他の区分の型は渡さない） */
  types: DayTypeProfile[]
  /** 判定する時点の残日数 */
  lead: number
  totalRooms: number
  /** その時点の予約室数 */
  otbRooms: number | null
  /** 結果の出た日の最終の稼働率 */
  finalOccupancy?: number | null
  /** 予約の記録が無いときに使う AI の予測稼働率 */
  predictedOccupancy?: number | null
}

/**
 * 1日・1時点の型を決める。
 * 結果があれば最終の稼働率、予約の記録があれば型の典型カーブでのその残日数の予約室数との近さ、どちらも無ければ予測稼働率で決める
 */
export function classifyDay(input: ClassifyDayInput): DayTypeProfile | null {
  const { types, lead, totalRooms, otbRooms, finalOccupancy, predictedOccupancy } = input
  if (types.length === 0 || totalRooms <= 0) return null
  if (finalOccupancy != null) return nearestByOccupancy(types, finalOccupancy)
  if (otbRooms != null) {
    const expected = types.map((t) => {
      const share = shareAtLead(t, lead)
      return share == null ? null : { type: t, rooms: share * t.avgOccupancy * totalRooms }
    })
    if (expected.every((e) => e != null)) {
      const list = expected as Array<{ type: DayTypeProfile; rooms: number }>
      return list.reduce((best, e) => (Math.abs(e.rooms - otbRooms) < Math.abs(best.rooms - otbRooms) ? e : best)).type
    }
  }
  if (predictedOccupancy != null) return nearestByOccupancy(types, Math.max(predictedOccupancy, (otbRooms ?? 0) / totalRooms))
  return null
}

export interface DayTypeHistoryPoint {
  /** 宿泊日までの残日数（0 = 当日） */
  daysBefore: number
  dayType: string | null
  otbRooms: number | null
}

export interface DayTypeCurrent {
  id: string
  name: string
  model: DayModel
  /** 型の平均の最終稼働率 */
  typicalOccupancy: number
}

export interface DayTypeTimeline {
  /** 今の型。宿泊日を過ぎた日は結果で決める。型を作れない（過去の実績が足りない）日は null */
  current: DayTypeCurrent | null
  /** 今より前の残日数ごとの型（残日数の大きい順） */
  history: DayTypeHistoryPoint[]
}

export interface DayTypeTimelineInput {
  stayDate: Date
  today: Date
  totalRooms: number
  /** この宿泊日の区分の型 */
  types: DayTypeProfile[]
  /** この宿泊日の予約積上 */
  points: BookingCurvePoint[]
  /** この日の販売室数（結果が出ていれば） */
  actualSoldRooms: number | null
  /** 今の AI の予測稼働率 */
  predictedOccupancy: number | null
}

const toCurrent = (t: DayTypeProfile | null): DayTypeCurrent | null =>
  t ? { id: t.id, name: t.name, model: t.model, typicalOccupancy: t.avgOccupancy } : null

/** 1日ぶんの「今の型」と、残日数ごとの型の推移を出す */
export function buildDayTypeTimeline(input: DayTypeTimelineInput): DayTypeTimeline {
  const { stayDate, today, totalRooms, types, points, actualSoldRooms, predictedOccupancy } = input
  const currentLead = leadDaysBetween(today, stayDate)
  const finalRooms = actualSoldRooms ?? otbAtLead(points, 0)

  const history: DayTypeHistoryPoint[] = []
  for (const lead of DAY_TYPE_HISTORY_LEADS) {
    if (lead <= currentLead) continue
    const atZero = lead === 0
    const otbRooms = atZero ? finalRooms : otbAtLead(points, lead)
    const type = classifyDay({
      types,
      lead,
      totalRooms,
      otbRooms,
      finalOccupancy: atZero && finalRooms != null && totalRooms > 0 ? finalRooms / totalRooms : null,
    })
    history.push({ daysBefore: lead, dayType: type?.name ?? null, otbRooms })
  }

  let current: DayTypeProfile | null
  if (currentLead < 0 || (currentLead === 0 && actualSoldRooms != null)) {
    current = classifyDay({
      types,
      lead: 0,
      totalRooms,
      otbRooms: finalRooms,
      finalOccupancy: finalRooms != null && totalRooms > 0 ? finalRooms / totalRooms : null,
    })
  } else {
    current = classifyDay({
      types,
      lead: currentLead,
      totalRooms,
      otbRooms: otbAtLead(points, currentLead),
      predictedOccupancy,
    })
  }
  return { current: toCurrent(current), history }
}

/** 優先モデルで重みを寄せる幅（ポイント） */
export const MODEL_WEIGHT_SHIFT = 20

/**
 * 初期値の重み（価格戦略の初期値設定）を、日の優先モデルに合わせて寄せる。
 * 稼働優先は単価の重みから、単価優先は稼働の重みから MODEL_WEIGHT_SHIFT ポイントまで移す（合計は 100 のまま）
 */
export function weightsForModel<T extends { weightOccupancy: number; weightAdr: number; weightCompetitor: number }>(
  weights: T,
  model: DayModel | null
): T {
  if (model == null || model === 'balanced') return weights
  if (model === 'occupancy') {
    const move = Math.min(MODEL_WEIGHT_SHIFT, weights.weightAdr)
    return { ...weights, weightOccupancy: weights.weightOccupancy + move, weightAdr: weights.weightAdr - move }
  }
  const move = Math.min(MODEL_WEIGHT_SHIFT, weights.weightOccupancy)
  return { ...weights, weightOccupancy: weights.weightOccupancy - move, weightAdr: weights.weightAdr + move }
}
