// 日のタイプ（日のモデル — 2026-10 の画面修正。PDF b01・b02・b03・c分析01実績推移2、xlsx DP02・DP03・分析03。
// D-13 で先方の「需要予測手段（案）」②に合わせて分け方を置き換えた）。
//
// 先方の指示: 「平日A型・平日B型・週末A型・特日A型…のように日を分類する。種類の数と構成は AI に判断させる」
// 「稼働と単価のどちらを優先するかは日の分類で AI が割り当て、販売の進み方で最適なモデルに変える」
// 「最終的な着地点（最終OCC・ADR）から逆算して、高稼働・高単価／高稼働・低単価／低稼働・高単価／低稼働・低単価に分類する」。
// ここでは次のように分ける（DB 非依存の純関数。データの読み込みは services/dayTypeService.ts）:
//   1. 日の区分: 特日（祝日・祝前日・お盆・年末年始・GW、特殊日のイベント）／週末（Hotel.weekendDays）／平日
//   2. 区分ごとに、過去の日の最終の稼働率と ADR の中央値で4象限に分ける。
//      A = 高稼働・高単価、B = 高稼働・低単価、C = 低稼働・高単価、D = 低稼働・低単価（例: 平日B型）。
//      ADR の記録が無い区分は稼働だけで A（高稼働）・D（低稼働）。日数が MIN_DAYS_PER_TYPE に満たない象限は、
//      稼働の同じ側の象限にまとめる。日数が少ない・ばらつきが小さい区分は A 型の1つ
//   3. 型ごとに、典型的なブッキングカーブ（残日数ごとの「最終に対する予約の割合」の中央値）と優先モデルを持つ。
//      高稼働（A・B）= 単価優先、低稼働（C・D）= 稼働優先。ただし高稼働の象限でも平均稼働が 65%以下ならバランス、
//      低稼働の象限でも 85%以上ならバランス（ホテル全体が強い・弱いときに極端に寄せない）
//   4. 先の日は、今の予約室数が型の典型カーブ（その残日数での予約室数）のどれに近いかで稼働の側を決め、
//      予測 ADR があれば単価の側を決める。予約が進むと型が変わり、優先モデルも変わる。
//      予約の記録が無ければ AI の予測稼働率、結果の出た日は最終の稼働率・ADR で決める
// リードタイムのマイルストーン別のピックアップの型（①）と、背景が近い日からの予測は dayPattern.ts。

import { otbAtLead, leadDaysBetween, type BookingCurvePoint } from './pace.js'

export type DayCategory = 'weekday' | 'weekend' | 'special'
export const DAY_CATEGORY_LABELS: Record<DayCategory, string> = { weekday: '平日', weekend: '週末', special: '特日' }

/** 稼働と単価のどちらを優先して価格を決めるか */
export type DayModel = 'occupancy' | 'balanced' | 'adr'
export const DAY_MODEL_LABELS: Record<DayModel, string> = { occupancy: '稼働優先', balanced: 'バランス', adr: '単価優先' }

/** 着地の4象限 */
export type DayQuadrant = 'A' | 'B' | 'C' | 'D'
export const DAY_QUADRANT_LABELS: Record<DayQuadrant, string> = {
  A: '高稼働・高単価',
  B: '高稼働・低単価',
  C: '低稼働・高単価',
  D: '低稼働・低単価',
}

/** 型の数の上限（A〜D） */
export const MAX_DAY_TYPES = 4
/** 1つの型に必要な日数。これより小さい象限は稼働の同じ側にまとめる */
export const MIN_DAYS_PER_TYPE = 5
/** 稼働率のばらつき（標準偏差）がこれ未満、かつ ADR のばらつき（変動係数）が MIN_ADR_SPREAD 未満なら分けない */
export const MIN_OCCUPANCY_SPREAD = 0.03
export const MIN_ADR_SPREAD = 0.03
/** 平均の稼働がこれ以上の型は単価優先、これ以下の型は稼働優先（象限の向きと食い違うときはバランス） */
export const ADR_PRIORITY_OCCUPANCY = 0.85
export const OCCUPANCY_PRIORITY_OCCUPANCY = 0.65
/** 典型カーブを出す残日数（予約積上を取り込む残日数とそろえる） */
export const CURVE_GRID_LEADS = [180, 120, 90, 60, 45, 30, 21, 14, 7, 5, 3, 1, 0] as const
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
  /** 着地の象限（A〜D）。まとめた型は日数の多い象限 */
  quadrant: DayQuadrant
  /** 例: "高稼働・高単価"。稼働の側だけでまとめた型は "高稼働" / "低稼働" */
  quadrantLabel: string
  /** 型に入った過去の日数 */
  days: number
  /** 平均の最終稼働率 */
  avgOccupancy: number
  /** 型に入る稼働率の範囲（過去の日の最小・最大） */
  minOccupancy: number
  maxOccupancy: number
  avgAdr: number | null
  model: DayModel
  /** 区分の稼働率の境目（中央値）。これ以上が高稼働 */
  occupancyThreshold: number
  /** 区分の ADR の境目（中央値）。これ以上が高単価。ADR の記録が無い区分は null */
  adrThreshold: number | null
  /** 典型カーブ: 残日数ごとの「最終に対する予約の割合」の中央値。日数が足りない残日数は含めない */
  curveShare: Array<{ daysBefore: number; share: number }>
}

const round3 = (v: number) => Math.round(v * 1000) / 1000
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)
const mean = (values: number[]) => sum(values) / values.length
const std = (values: number[]) => {
  if (values.length === 0) return 0
  const m = mean(values)
  return Math.sqrt(sum(values.map((v) => (v - m) ** 2)) / values.length)
}
const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** 平均の稼働だけで決める優先モデル（象限に分けられない区分の A 型） */
export function modelForOccupancy(avgOccupancy: number): DayModel {
  if (avgOccupancy >= ADR_PRIORITY_OCCUPANCY) return 'adr'
  if (avgOccupancy <= OCCUPANCY_PRIORITY_OCCUPANCY) return 'occupancy'
  return 'balanced'
}

/** 象限と平均の稼働から優先モデルを決める */
export function modelForQuadrant(quadrant: DayQuadrant, avgOccupancy: number): DayModel {
  const high = quadrant === 'A' || quadrant === 'B'
  if (high) return avgOccupancy <= OCCUPANCY_PRIORITY_OCCUPANCY ? 'balanced' : 'adr'
  return avgOccupancy >= ADR_PRIORITY_OCCUPANCY ? 'balanced' : 'occupancy'
}

/** 稼働・ADR と区分の境目から象限を決める（ADR が分からなければ同じ稼働の側の高単価の象限） */
export function quadrantOf(occupancy: number, adr: number | null, occupancyThreshold: number, adrThreshold: number | null): DayQuadrant {
  const high = occupancy >= occupancyThreshold
  const highAdr = adr == null || adrThreshold == null ? true : adr >= adrThreshold
  if (high) return highAdr ? 'A' : 'B'
  return highAdr ? 'C' : 'D'
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

interface Group {
  quadrant: DayQuadrant
  label: string
  members: DayTypeHistoryDay[]
}

/** 1つの区分の日を象限に分ける。小さい象限は稼働の同じ側にまとめ、それでも小さければ区分全体を1つにする */
function groupByQuadrant(days: DayTypeHistoryDay[]): { groups: Group[]; occT: number; adrT: number | null } {
  const occT = median(days.map((d) => d.occupancy))
  const adrs = days.map((d) => d.adr).filter((v): v is number => v != null)
  const adrT = adrs.length >= MIN_DAYS_PER_TYPE ? median(adrs) : null
  const occSpread = std(days.map((d) => d.occupancy))
  const adrSpread = adrs.length > 0 ? std(adrs) / Math.max(1, mean(adrs)) : 0
  const single = (): Group[] => [{ quadrant: 'A', label: '全体', members: days }]
  if (days.length < MIN_DAYS_PER_TYPE * 2 || (occSpread < MIN_OCCUPANCY_SPREAD && adrSpread < MIN_ADR_SPREAD)) {
    return { groups: single(), occT, adrT }
  }

  const buckets = new Map<DayQuadrant, DayTypeHistoryDay[]>()
  for (const day of days) {
    // ADR が無い日は同じ稼働の側の多いほうに入れる（下で決める）ため、いったん高単価側に置く
    const q = quadrantOf(day.occupancy, day.adr, occT, adrT)
    buckets.set(q, [...(buckets.get(q) ?? []), day])
  }
  const groups: Group[] = []
  for (const [hi, lo, sideLabel] of [
    ['A', 'B', '高稼働'],
    ['C', 'D', '低稼働'],
  ] as const) {
    const a = buckets.get(hi) ?? []
    const b = buckets.get(lo) ?? []
    if (a.length === 0 && b.length === 0) continue
    if (adrT == null) {
      // ADR の記録が無い区分は稼働だけで分ける（高稼働 = A、低稼働 = D）
      groups.push({ quadrant: hi === 'A' ? 'A' : 'D', label: sideLabel, members: [...a, ...b] })
    } else if (a.length >= MIN_DAYS_PER_TYPE && b.length >= MIN_DAYS_PER_TYPE) {
      groups.push({ quadrant: hi, label: DAY_QUADRANT_LABELS[hi], members: a })
      groups.push({ quadrant: lo, label: DAY_QUADRANT_LABELS[lo], members: b })
    } else {
      groups.push({ quadrant: a.length >= b.length ? hi : lo, label: sideLabel, members: [...a, ...b] })
    }
  }
  if (groups.some((g) => g.members.length < MIN_DAYS_PER_TYPE)) return { groups: single(), occT, adrT }
  return { groups, occT, adrT }
}

/** 過去の日から、区分ごとの型を作る。区分ごとに着地の象限（A〜D）で分ける */
export function buildDayTypes(history: DayTypeHistoryDay[]): DayTypeProfile[] {
  const profiles: DayTypeProfile[] = []
  for (const category of ['weekday', 'weekend', 'special'] as const) {
    const days = history.filter((d) => d.category === category)
    if (days.length < MIN_DAYS_PER_TYPE) continue
    const { groups, occT, adrT } = groupByQuadrant(days)
    const isSingle = groups.length === 1 && groups[0].label === '全体'
    for (const group of groups.sort((a, b) => a.quadrant.localeCompare(b.quadrant))) {
      const occ = group.members.map((d) => d.occupancy)
      const adrs = group.members.map((d) => d.adr).filter((v): v is number => v != null)
      const avgOccupancy = round3(mean(occ))
      profiles.push({
        id: `${category}-${group.quadrant}`,
        name: `${DAY_CATEGORY_LABELS[category]}${group.quadrant}型`,
        category,
        letter: group.quadrant,
        quadrant: group.quadrant,
        quadrantLabel: group.label,
        days: group.members.length,
        avgOccupancy,
        minOccupancy: round3(Math.min(...occ)),
        maxOccupancy: round3(Math.max(...occ)),
        avgAdr: adrs.length > 0 ? Math.round(mean(adrs)) : null,
        model: isSingle ? modelForOccupancy(avgOccupancy) : modelForQuadrant(group.quadrant, avgOccupancy),
        occupancyThreshold: round3(occT),
        adrThreshold: adrT == null ? null : Math.round(adrT),
        curveShare: buildCurveShare(group.members),
      })
    }
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
  /** 結果の出た日の ADR */
  finalAdr?: number | null
  /** 予約の記録が無いときに使う AI の予測稼働率 */
  predictedOccupancy?: number | null
  /** AI の予測 ADR（単価の側を決める。無ければ稼働の側だけで決める） */
  predictedAdr?: number | null
}

/** 稼働の側が決まったあと、単価の側を決める。ADR が分からなければ base のまま */
function pickByAdr(types: DayTypeProfile[], base: DayTypeProfile, adr: number | null | undefined): DayTypeProfile {
  if (adr == null || base.adrThreshold == null) return base
  const high = base.quadrant === 'A' || base.quadrant === 'B'
  const want: DayQuadrant = high ? (adr >= base.adrThreshold ? 'A' : 'B') : adr >= base.adrThreshold ? 'C' : 'D'
  return types.find((t) => t.quadrant === want) ?? base
}

/**
 * 1日・1時点の型を決める。
 * 結果があれば最終の稼働率・ADR、予約の記録があれば型の典型カーブでのその残日数の予約室数との近さ、どちらも無ければ予測稼働率で
 * 稼働の側を決め、ADR（結果か予測）で単価の側を決める
 */
export function classifyDay(input: ClassifyDayInput): DayTypeProfile | null {
  const { types, lead, totalRooms, otbRooms, finalOccupancy, finalAdr, predictedOccupancy, predictedAdr } = input
  if (types.length === 0 || totalRooms <= 0) return null
  if (finalOccupancy != null) {
    const t = types[0]
    const q = quadrantOf(finalOccupancy, finalAdr ?? null, t.occupancyThreshold, t.adrThreshold)
    const side = q === 'A' || q === 'B' ? ['A', 'B'] : ['C', 'D']
    return (
      types.find((x) => x.quadrant === q) ??
      types.find((x) => side.includes(x.quadrant)) ??
      nearestByOccupancy(types, finalOccupancy)
    )
  }
  if (otbRooms != null) {
    const expected = types.map((t) => {
      const share = shareAtLead(t, lead)
      return share == null ? null : { type: t, rooms: share * t.avgOccupancy * totalRooms }
    })
    if (expected.every((e) => e != null)) {
      const list = expected as Array<{ type: DayTypeProfile; rooms: number }>
      const nearest = list.reduce((best, e) => (Math.abs(e.rooms - otbRooms) < Math.abs(best.rooms - otbRooms) ? e : best)).type
      return pickByAdr(types, nearest, predictedAdr)
    }
  }
  if (predictedOccupancy != null) {
    return pickByAdr(types, nearestByOccupancy(types, Math.max(predictedOccupancy, (otbRooms ?? 0) / totalRooms)), predictedAdr)
  }
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
  /** 今の AI の予測 ADR（単価の側を決める） */
  predictedAdr?: number | null
  /** この日の ADR（結果が出ていれば） */
  actualAdr?: number | null
}

const toCurrent = (t: DayTypeProfile | null): DayTypeCurrent | null =>
  t ? { id: t.id, name: t.name, model: t.model, typicalOccupancy: t.avgOccupancy } : null

/** 1日ぶんの「今の型」と、残日数ごとの型の推移を出す */
export function buildDayTypeTimeline(input: DayTypeTimelineInput): DayTypeTimeline {
  const { stayDate, today, totalRooms, types, points, actualSoldRooms, predictedOccupancy, predictedAdr, actualAdr } = input
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
      finalAdr: atZero ? (actualAdr ?? null) : null,
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
      finalAdr: actualAdr ?? null,
    })
  } else {
    current = classifyDay({
      types,
      lead: currentLead,
      totalRooms,
      otbRooms: otbAtLead(points, currentLead),
      predictedOccupancy,
      predictedAdr,
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
