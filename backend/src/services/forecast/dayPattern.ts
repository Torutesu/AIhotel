// 日のパターン（D-13 — 先方の「需要予測手段（案）」をもとに 2026-11）。
//
// 1. リードタイムのマイルストーン（180・120・90・60・30・14・5 日前と当日）で、その区間に入った予約（ピックアップ）を
//    客室数に対する割合で切り出し、8次元の特徴にする。360日分の曲線をそのまま比べるのではなく、販売戦略上の節目での
//    入り方の速さで比べる
// 2. 過去の日の特徴を k-means でクラスタに分ける（ピックアップ型）。クラスタの数はシルエット係数が最大になる数を
//    2〜MAX_PACE_CLUSTERS の中から選ぶ（データが少ないホテルは少なく、多いホテルは多くなる）
// 3. 先の日は「日の背景」（区分・曜日・季節・連休の並び・イベント・天気）と「ここまでの入り方」が近い過去の日（近傍）を探し、
//    近傍の「今の残日数から当日までに入った室数」を今の予約室数に足して着地を予測する（加算型ピックアップ法）。
//    近傍の ADR・ピックアップ型・着地の4象限も同じ重みで出す
// 着地の4象限（稼働×単価）の区分けは dayType.ts。ここは DB 非依存の純関数で、テストで固定する。

import { otbAtLead, type BookingCurvePoint } from './pace.js'
import type { HolidayRun } from '../../lib/jpHolidays.js'
import type { TravelSeasonKey } from '../../lib/travelSeasons.js'

const DAY_MS = 86_400_000

/** ピックアップを切り出すマイルストーン（残日数）。先方の案の区切り（180日前以前・179〜120日前…13〜5日前）に当日までを足した */
export const PICKUP_MILESTONES = [180, 120, 90, 60, 30, 14, 5, 0] as const
/** 区間の名前（PICKUP_MILESTONES と同じ並び） */
export const PICKUP_TERM_LABELS = [
  '180日前以前',
  '179〜120日前',
  '119〜90日前',
  '89〜60日前',
  '59〜30日前',
  '29〜14日前',
  '13〜5日前',
  '4日前〜当日',
] as const

/** ピックアップ型の数の上限（先方の案は 15〜20） */
export const MAX_PACE_CLUSTERS = 20
/** 1つのピックアップ型に平均で必要な日数。これで型の数の上限を絞る（データの少ないホテルで型が細かくなりすぎない） */
export const MIN_DAYS_PER_PACE_CLUSTER = 6
/** 近傍の数 */
export const NEIGHBOR_COUNT = 12
/** 近傍の予測を出すのに必要な過去の日数 */
export const MIN_PATTERN_HISTORY = 20

const round3 = (v: number) => Math.round(v * 1000) / 1000

/**
 * 1日のピックアップの特徴（客室数に対する割合）。[0] は 180日前時点の予約、[i] は PICKUP_MILESTONES[i-1]〜[i] の間に入った予約。
 * その時点の記録が無い区間は null。最終（当日）は finalRooms を使う
 */
export function pickupVector(points: BookingCurvePoint[], finalRooms: number | null, totalRooms: number): Array<number | null> {
  if (totalRooms <= 0) return PICKUP_MILESTONES.map(() => null)
  const at = PICKUP_MILESTONES.map((lead) => (lead === 0 && finalRooms != null ? finalRooms : otbAtLead(points, lead)))
  return at.map((rooms, i) => {
    if (rooms == null) return null
    if (i === 0) return round3(rooms / totalRooms)
    const prev = at[i - 1]
    return prev == null ? null : round3((rooms - prev) / totalRooms)
  })
}

/** 残日数 lead の時点で、もう終わっている区間の数（その区間のピックアップは今の予約から分かる） */
export function completedTerms(lead: number): number {
  return PICKUP_MILESTONES.filter((m) => m >= lead).length
}

// ---- k-means ----

/** 再現できる乱数（同じデータなら毎回同じクラスタになるように） */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const sqDist = (a: number[], b: number[]) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0)

export interface KMeansResult {
  assignments: number[]
  centroids: number[][]
}

/** k-means（k-means++ の初期値・最大 100 回）。vectors はすべて同じ長さで欠けの無いもの */
export function kMeans(vectors: number[][], k: number, seed = 1): KMeansResult {
  const n = vectors.length
  const rand = mulberry32(seed)
  const centroids: number[][] = [vectors[Math.floor(rand() * n)]]
  while (centroids.length < k) {
    const d2 = vectors.map((v) => Math.min(...centroids.map((c) => sqDist(v, c))))
    const total = d2.reduce((a, b) => a + b, 0)
    if (total === 0) break
    let r = rand() * total
    let idx = 0
    while (idx < n - 1 && r > d2[idx]) r -= d2[idx++]
    centroids.push(vectors[idx])
  }
  let assignments = new Array<number>(n).fill(-1)
  for (let iter = 0; iter < 100; iter++) {
    const next = vectors.map((v) => {
      let best = 0
      let bestD = Infinity
      centroids.forEach((c, ci) => {
        const dd = sqDist(v, c)
        if (dd < bestD) {
          bestD = dd
          best = ci
        }
      })
      return best
    })
    const changed = next.some((a, i) => a !== assignments[i])
    assignments = next
    for (let ci = 0; ci < centroids.length; ci++) {
      const members = vectors.filter((_, i) => assignments[i] === ci)
      if (members.length === 0) continue
      centroids[ci] = members[0].map((_, dim) => members.reduce((s, m) => s + m[dim], 0) / members.length)
    }
    if (!changed) break
  }
  return { assignments, centroids }
}

/** シルエット係数の平均（-1〜1。大きいほどクラスタがよく分かれている） */
export function silhouetteScore(vectors: number[][], assignments: number[]): number {
  const n = vectors.length
  const clusters = [...new Set(assignments)]
  if (clusters.length < 2) return 0
  let total = 0
  for (let i = 0; i < n; i++) {
    const sums = new Map<number, { sum: number; count: number }>()
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      const entry = sums.get(assignments[j]) ?? { sum: 0, count: 0 }
      entry.sum += Math.sqrt(sqDist(vectors[i], vectors[j]))
      entry.count++
      sums.set(assignments[j], entry)
    }
    const own = sums.get(assignments[i])
    if (!own || own.count === 0) continue // 1日だけのクラスタは 0
    const a = own.sum / own.count
    let b = Infinity
    for (const [c, e] of sums) if (c !== assignments[i] && e.count > 0) b = Math.min(b, e.sum / e.count)
    total += b === Infinity ? 0 : (b - a) / Math.max(a, b) || 0
  }
  return total / n
}

export interface PaceClusterProfile {
  /** P01 が最終の稼働の高い型 */
  id: string
  days: number
  /** 区間ごとのピックアップの平均（客室数に対する割合。PICKUP_TERM_LABELS と同じ並び） */
  centroid: number[]
  /** 平均の最終稼働率（centroid の合計） */
  finalOccupancy: number
  /** 入り方の形。先行型 = 60日前までに半分以上、直前型 = 14日前以降に半分以上、それ以外は標準型 */
  shape: '先行型' | '標準型' | '直前型'
}

export interface PaceClustering {
  clusters: PaceClusterProfile[]
  /** 入力と同じ並びのクラスタ ID（欠けのある日・分けられなかった日は null） */
  assignments: Array<string | null>
  /** 選んだ数でのシルエット係数 */
  silhouette: number
}

function shapeOf(centroid: number[]): PaceClusterProfile['shape'] {
  const total = centroid.reduce((a, b) => a + Math.max(0, b), 0)
  if (total <= 0) return '標準型'
  // [0..3] = 60日前まで、[6..7] = 13日前以降（14日前〜当日のうち、29〜14日前 [5] は含めない）
  const early = centroid.slice(0, 4).reduce((a, b) => a + Math.max(0, b), 0)
  const late = centroid.slice(6).reduce((a, b) => a + Math.max(0, b), 0)
  if (early / total >= 0.5) return '先行型'
  if (late / total >= 0.5) return '直前型'
  return '標準型'
}

/**
 * 過去の日のピックアップの特徴をクラスタに分ける。欠けのある日は分けない（null）。
 * 型の数は 2〜min(MAX_PACE_CLUSTERS, 日数 ÷ MIN_DAYS_PER_PACE_CLUSTER) の中でシルエット係数が最大の数
 */
export function clusterPickupCurves(vectors: Array<Array<number | null>>): PaceClustering {
  const complete = vectors.map((v, i) => ({ v, i })).filter((e): e is { v: number[]; i: number } => e.v.every((x) => x != null))
  const assignments: Array<string | null> = vectors.map(() => null)
  if (complete.length < MIN_DAYS_PER_PACE_CLUSTER * 2) return { clusters: [], assignments, silhouette: 0 }
  const data = complete.map((e) => e.v)
  const maxK = Math.min(MAX_PACE_CLUSTERS, Math.floor(data.length / MIN_DAYS_PER_PACE_CLUSTER))
  let best: { result: KMeansResult; score: number } | null = null
  for (let k = 2; k <= maxK; k++) {
    const result = kMeans(data, k)
    const score = silhouetteScore(data, result.assignments)
    if (!best || score > best.score + 1e-9) best = { result, score }
  }
  if (!best) return { clusters: [], assignments, silhouette: 0 }
  const { result } = best
  const order = result.centroids
    .map((c, ci) => ({ ci, c, days: result.assignments.filter((a) => a === ci).length, final: c.reduce((a, b) => a + b, 0) }))
    .filter((e) => e.days > 0)
    .sort((a, b) => b.final - a.final)
  const idOf = new Map(order.map((e, i) => [e.ci, `P${String(i + 1).padStart(2, '0')}`]))
  complete.forEach((e, j) => (assignments[e.i] = idOf.get(result.assignments[j]) ?? null))
  return {
    clusters: order.map((e) => ({
      id: idOf.get(e.ci) as string,
      days: e.days,
      centroid: e.c.map(round3),
      finalOccupancy: round3(e.final),
      shape: shapeOf(e.c),
    })),
    assignments,
    silhouette: Math.round(best.score * 1000) / 1000,
  }
}

// ---- 近傍による予測 ----

/** 天気の大分類（気象庁の天気コードの先頭の桁: 1 = 晴れ・2 = くもり・3 = 雨・4 = 雪） */
export type WeatherClass = 1 | 2 | 3 | 4

/** 日の背景（外部要因）。先の日も過去の日も同じ形で持つ */
export interface DayContext {
  date: Date
  category: 'weekday' | 'weekend' | 'special'
  /** イベントの影響（稼働率への加算幅。0.15 = high） */
  eventImpact: number
  holiday: HolidayRun
  /** 旅行シーズン（年末年始・春休み・春節など。lib/travelSeasons.ts） */
  seasons: TravelSeasonKey[]
  /** 天気（予報か、その日の予報の最後の値）。無ければ null */
  weather: WeatherClass | null
}

export interface PatternHistoryDay {
  context: DayContext
  points: BookingCurvePoint[]
  finalRooms: number
  adr: number | null
  /** pickupVector の結果 */
  pickup: Array<number | null>
  paceCluster: string | null
}

export interface PatternPredictInput {
  context: DayContext
  /** 今の残日数（0 以上） */
  lead: number
  /** 今の予約室数。記録が無ければ null */
  otbRooms: number | null
  /** この宿泊日の予約積上（終わった区間の入り方を比べる） */
  points: BookingCurvePoint[]
  totalRooms: number
}

export interface PatternPrediction {
  /** 予測の着地の稼働率 */
  occupancy: number
  /** 近傍の ADR の加重平均（ADR の無いホテルは null） */
  adr: number | null
  /** 使った近傍の数 */
  neighbors: number
  /** 近傍の着地の散らばり（稼働率の加重標準偏差） */
  spread: number
  /** 今の予約に足した、近傍の「今から当日まで」のピックアップ（室）。今の予約が無ければ null */
  pickupRooms: number | null
  /** 近傍で最も重みの大きいピックアップ型 */
  paceCluster: string | null
  /** 近傍のうちイベントのあった日の重みの割合（0〜1） */
  eventShare: number
  /** 重みの大きい近傍の日付（日のAI分析の「似た日」） */
  similarDates: Date[]
}

const dayOfYear = (date: Date) => Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 1)) / DAY_MS)

/** 日の背景の離れ具合（0 = 同じ。区分の違いが最も大きい） */
export function contextDistance(a: DayContext, b: DayContext): number {
  let d = 0
  if (a.category !== b.category) d += 1
  if (a.date.getUTCDay() !== b.date.getUTCDay()) d += 0.3
  const diff = Math.abs(dayOfYear(a.date) - dayOfYear(b.date))
  d += (Math.min(diff, 365 - diff) / 182) * 0.6 // 季節（半年離れて 0.6）
  d += Math.abs(a.eventImpact - b.eventImpact) * 3 // high（0.15）の有無で 0.45
  if (a.holiday.beforeDayOff !== b.holiday.beforeDayOff) d += 0.5
  d += Math.min(0.3, Math.abs(a.holiday.daysOffAhead - b.holiday.daysOffAhead) * 0.1)
  // 旅行シーズンの重なり（Jaccard）。どちらもシーズン外なら 0
  if (a.seasons.length > 0 || b.seasons.length > 0) {
    const shared = a.seasons.filter((s) => b.seasons.includes(s)).length
    const union = new Set([...a.seasons, ...b.seasons]).size
    d += (1 - shared / union) * 0.4
  }
  // 日々の天気は宿泊にはあまり効かない（先方の資料 ②）ので小さく。台風・災害はイベント（特殊日）で扱う
  if (a.weather != null && b.weather != null && a.weather !== b.weather) d += 0.1
  return d
}

/** 残日数ごとの「ここまでの入り方」の効かせ方。宿泊日が近いほど、今の予約が着地をよく表す */
export function paceDistanceWeight(lead: number): number {
  if (lead <= 30) return 4
  if (lead <= 90) return 3
  return 2
}

/**
 * 近傍（背景と入り方が近い過去の日）から着地を予測する。過去の日が MIN_PATTERN_HISTORY 未満なら null
 */
export function predictFromNeighbors(input: PatternPredictInput, history: PatternHistoryDay[]): PatternPrediction | null {
  const { context, lead, otbRooms, points, totalRooms } = input
  if (totalRooms <= 0 || history.length < MIN_PATTERN_HISTORY) return null
  const done = completedTerms(lead)
  const ownPickup = pickupVector(points, null, totalRooms)
  const paceW = paceDistanceWeight(lead)

  const scored = history.map((h) => {
    let d = contextDistance(context, h.context)
    const hOtb = otbAtLead(h.points, lead)
    if (otbRooms != null && hOtb != null) d += (Math.abs(otbRooms - hOtb) / totalRooms) * paceW
    else if (otbRooms != null) d += 0.5 // 比べられない日は少し遠くする
    // 終わった区間の入り方（区間ごとの差の二乗平均）
    let sq = 0
    let cnt = 0
    for (let i = 0; i < done; i++) {
      const own = ownPickup[i]
      const other = h.pickup[i]
      if (own == null || other == null) continue
      sq += (own - other) ** 2
      cnt++
    }
    if (cnt > 0) d += Math.sqrt(sq / cnt) * paceW
    // 新しい日を少し優先する（1年前で 0.1）
    d += (Math.abs(context.date.getTime() - h.context.date.getTime()) / (365 * DAY_MS)) * 0.1
    return { h, d, hOtb }
  })
  scored.sort((a, b) => a.d - b.d)
  const near = scored.slice(0, NEIGHBOR_COUNT)
  const weights = near.map((n) => 1 / (0.05 + n.d))
  const wSum = weights.reduce((a, b) => a + b, 0)

  // 着地: 今の予約がある日は「今の予約 + 近傍のこれからのピックアップ」、無い日は近傍の着地
  const pickupPairs = near.map((n, i) => ({ n, w: weights[i] })).filter((p) => p.n.hOtb != null)
  let finalRooms: number
  let pickupRooms: number | null = null
  if (otbRooms != null && pickupPairs.length >= Math.ceil(near.length / 2)) {
    const pw = pickupPairs.reduce((a, p) => a + p.w, 0)
    pickupRooms = pickupPairs.reduce((a, p) => a + p.w * (p.n.h.finalRooms - (p.n.hOtb as number)), 0) / pw
    finalRooms = otbRooms + Math.max(0, pickupRooms)
  } else {
    finalRooms = near.reduce((a, n, i) => a + weights[i] * n.h.finalRooms, 0) / wSum
    if (otbRooms != null) finalRooms = Math.max(finalRooms, otbRooms)
  }
  const occupancy = Math.min(1, Math.max(0, finalRooms / totalRooms))
  const mean = near.reduce((a, n, i) => a + weights[i] * (n.h.finalRooms / totalRooms), 0) / wSum
  const spread = Math.sqrt(near.reduce((a, n, i) => a + weights[i] * (n.h.finalRooms / totalRooms - mean) ** 2, 0) / wSum)

  const adrPairs = near.map((n, i) => ({ adr: n.h.adr, w: weights[i] })).filter((p): p is { adr: number; w: number } => p.adr != null)
  const adrW = adrPairs.reduce((a, p) => a + p.w, 0)
  const clusterWeight = new Map<string, number>()
  near.forEach((n, i) => {
    if (n.h.paceCluster) clusterWeight.set(n.h.paceCluster, (clusterWeight.get(n.h.paceCluster) ?? 0) + weights[i])
  })
  const paceCluster = [...clusterWeight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const eventShare = near.reduce((a, n, i) => a + (n.h.context.eventImpact > 0 ? weights[i] : 0), 0) / wSum

  return {
    occupancy: round3(occupancy),
    adr: adrW > 0 ? Math.round(adrPairs.reduce((a, p) => a + p.adr * p.w, 0) / adrW) : null,
    neighbors: near.length,
    spread: round3(spread),
    pickupRooms: pickupRooms == null ? null : Math.round(pickupRooms * 10) / 10,
    paceCluster,
    eventShare: round3(eventShare),
    similarDates: near.slice(0, 5).map((n) => n.h.context.date),
  }
}

/**
 * 近傍の予測を需要予測に混ぜる割合。先方の見立て（3か月を切ったあたりから精度が上がる）に合わせ、90日以内で強く効かせる。
 * 近傍の散らばりが大きい（似た日でも着地がばらつく）ときは弱める
 */
export function patternBlendWeight(lead: number, spread: number): number {
  const base = lead <= 90 ? 0.7 : lead <= 180 ? 0.5 : 0.3
  const penalty = Math.min(0.5, Math.max(0, spread - 0.1) * 2) // 散らばり 10pt を超えた分だけ下げる（35pt で半分）
  return round3(base * (1 - penalty))
}
