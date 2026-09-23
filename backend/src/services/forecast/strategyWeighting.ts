// 価格戦略の重み付け（F-DP-02）を推奨ランク算出へ反映するための純粋ロジック。
//
// PricingStrategyConfig（稼働率 / ADR / 競合、合計100%）は従来保存・監査されて
// いたものの価格算出から参照されておらず、重みを変更しても推奨価格が変化しな
// かった。本モジュールは3つの観点をそれぞれ「料金ランク」に写像したうえで、
// 設定された重みで加重平均する。
//
// 写像の考え方:
//   - 稼働率観点: 予測稼働率に対応するランク（ruleBasedForecaster が算出）
//   - ADR観点  : 直近の同曜日ADR実績に見合うランク（実績に価格を追随させる）
//   - 競合観点  : 対象日の競合価格の中央値に見合うランク（競合に価格を追随させる）。
//                 C-9 に合わせて平均ではなく中央値を使い、1社の極端な価格に引きずられないようにする
//
// データが存在しない観点は合成から除外し、その重みを残りの観点へ按分する。
// 競合価格が未取得の日に「競合ランク=0」として引き下げてしまうことを防ぐため。
//
// ※ 各観点をランクへ写像する方式そのものは #17（価格決定方程式の確定）の検討事項であり、
//   確定後に係数・写像方法を見直す前提の初版実装である（#76）。

import { median } from '../../lib/stats.js'

const DEFAULT_ADR_WINDOW_DAYS = 28

export interface StrategyWeights {
  weightOccupancy: number
  weightAdr: number
  weightCompetitor: number
}

/**
 * 料金ランクと料金の対応（PriceRank 由来）。
 * ADR 観点と予測ADRでは1名料金、競合観点では比較人数（#17 の competitorOccupancy）の料金を入れる
 */
export interface RankPrice {
  rank: number
  price: number
}

export interface AdrRecord {
  date: Date
  adr: number
}

export interface CompetitorPriceRecord {
  date: Date
  price: number
  /** 取得日時（#9）。鮮度の判定に使う */
  observedAt: Date
}

/** この時間を超えて古い競合価格は推奨に使わない（#9 §4、#17）。古い値で強気の推奨を出さないため */
export const COMPETITOR_PRICE_MAX_AGE_HOURS = 48

export interface BlendedRank {
  rank: number
  /** 合成に使用した各観点のランク（除外された観点は null） */
  components: {
    occupancy: number
    adr: number | null
    competitor: number | null
  }
  /** 按分後の実効重み（合計100。全観点が除外された場合は稼働率100） */
  effectiveWeights: StrategyWeights
}

/**
 * PricingStrategyConfig が存在しないホテルの既定値。
 * 従来挙動（稼働率のみで推奨ランクを決定）を維持する。
 */
export const OCCUPANCY_ONLY_WEIGHTS: StrategyWeights = {
  weightOccupancy: 100,
  weightAdr: 0,
  weightCompetitor: 0,
}

/**
 * 価格に最も近い料金ランクを引く。
 * 同着の場合は下位ランク（安い側）を採用し、意図しない値上げ方向への
 * 丸めが起きないようにする。
 */
export function mapPriceToRank(price: number, ranks: RankPrice[]): number | null {
  if (ranks.length === 0) return null

  let best: { rank: number; diff: number } | null = null
  for (const r of ranks) {
    const diff = Math.abs(r.price - price)
    if (best === null || diff < best.diff || (diff === best.diff && r.rank < best.rank)) {
      best = { rank: r.rank, diff }
    }
  }
  return best?.rank ?? null
}

/**
 * 基準ADR: 直近 windowDays 以内の同曜日ADR実績の平均。
 * 同曜日の実績が無ければ窓内の全実績平均にフォールバックし、それも無ければ null。
 * ADR観点のランクと predictedAdr（#77）の両方の起点になる。
 */
export function computeBaseAdr(
  history: AdrRecord[],
  targetDate: Date,
  windowDays = DEFAULT_ADR_WINDOW_DAYS
): number | null {
  const windowStart = new Date(targetDate)
  windowStart.setUTCDate(windowStart.getUTCDate() - windowDays)

  const inWindow = history.filter((h) => h.date >= windowStart && h.date < targetDate)
  if (inWindow.length === 0) return null

  const sameWeekday = inWindow.filter((h) => h.date.getUTCDay() === targetDate.getUTCDay())
  const source = sameWeekday.length > 0 ? sameWeekday : inWindow

  return source.reduce((sum, h) => sum + h.adr, 0) / source.length
}

/**
 * 基準ADR（computeBaseAdr）に対応するランク。
 * 実績が無ければ null（ADR観点を合成から除外）。
 */
export function computeAdrRank(
  history: AdrRecord[],
  targetDate: Date,
  ranks: RankPrice[],
  windowDays = DEFAULT_ADR_WINDOW_DAYS
): number | null {
  if (ranks.length === 0) return null
  const baseAdr = computeBaseAdr(history, targetDate, windowDays)
  return baseAdr == null ? null : mapPriceToRank(baseAdr, ranks)
}

/**
 * 予測ADR（#77）。
 *
 * 実績ADRは「実績ADRに見合うランク（基準ランク）」で売った結果とみなし、
 * 推奨ランクへ動かしたときの 1名料金の変化率を実績ADRに掛ける。
 * 料金ランクが無い・引けない場合は基準ADRをそのまま使い、ADR実績が無ければ null
 * （着地計算側で推奨価格へフォールバックする）。
 */
export function computePredictedAdr(params: {
  baseAdr: number | null
  recommendedRank: number
  ranks: RankPrice[]
}): number | null {
  const { baseAdr, recommendedRank, ranks } = params
  if (baseAdr == null) return null

  const baseRank = mapPriceToRank(baseAdr, ranks)
  const basePrice = ranks.find((r) => r.rank === baseRank)?.price
  const recommendedPrice = ranks.find((r) => r.rank === recommendedRank)?.price
  if (!basePrice || !recommendedPrice) return Math.round(baseAdr)

  return Math.round(baseAdr * (recommendedPrice / basePrice))
}

/**
 * 対象日の競合価格の中央値に対応するランク（#76）。
 *
 * - 取得から COMPETITOR_PRICE_MAX_AGE_HOURS を超えた値は使わない（#9 §4）
 * - offsetPct で「競合より X% 高く／安く」を狙う（#17）。+10 なら中央値の 1.1 倍に近いランク
 *
 * 使える値が1件も無ければ null（競合観点を合成から除外）。
 * 除外の理由を推奨理由（#24 E4）に残せるよう、stale / no_data を区別して返す。
 */
export function computeCompetitorRank(
  prices: CompetitorPriceRecord[],
  targetDate: Date,
  ranks: RankPrice[],
  options: { offsetPct?: number; now?: Date } = {}
): { rank: number | null; median: number | null; count: number; observedAt: Date | null; excluded: 'no_data' | 'stale' | null } {
  const none = { rank: null, median: null, count: 0, observedAt: null }
  if (ranks.length === 0) return { ...none, excluded: 'no_data' }

  const sameDay = prices.filter((p) => p.date.getTime() === targetDate.getTime())
  if (sameDay.length === 0) return { ...none, excluded: 'no_data' }

  const now = options.now ?? new Date()
  const oldest = now.getTime() - COMPETITOR_PRICE_MAX_AGE_HOURS * 3_600_000
  const fresh = sameDay.filter((p) => p.observedAt.getTime() >= oldest)
  if (fresh.length === 0) return { ...none, excluded: 'stale' }

  const representative = median(fresh.map((p) => p.price))
  if (representative == null) return { ...none, excluded: 'no_data' }

  const target = representative * (1 + (options.offsetPct ?? 0) / 100)
  const latest = fresh.reduce((a, b) => (a.observedAt > b.observedAt ? a : b)).observedAt
  return {
    rank: mapPriceToRank(target, ranks),
    median: representative,
    count: fresh.length,
    observedAt: latest,
    excluded: null,
  }
}

/**
 * 3観点のランクを重みで加重平均する。
 *
 * データが無い観点、および重み0の観点は合成対象から外し、残った観点の重みを
 * 合計100になるよう按分する。有効な観点が1つも残らない場合は稼働率観点の
 * ランクをそのまま採用する（稼働率は常に算出可能なため実質的な最終防衛線）。
 */
export function blendRanksByStrategy(params: {
  occupancyRank: number
  adrRank: number | null
  competitorRank: number | null
  weights: StrategyWeights
  maxRank: number
}): BlendedRank {
  const { occupancyRank, adrRank, competitorRank, weights, maxRank } = params

  const candidates = [
    { key: 'occupancy' as const, rank: occupancyRank, weight: weights.weightOccupancy },
    { key: 'adr' as const, rank: adrRank, weight: weights.weightAdr },
    { key: 'competitor' as const, rank: competitorRank, weight: weights.weightCompetitor },
  ]

  const usable = candidates.filter(
    (c): c is { key: 'occupancy' | 'adr' | 'competitor'; rank: number; weight: number } =>
      c.rank !== null && c.weight > 0
  )

  const totalWeight = usable.reduce((sum, c) => sum + c.weight, 0)

  const components = {
    occupancy: occupancyRank,
    adr: usable.some((c) => c.key === 'adr') ? adrRank : null,
    competitor: usable.some((c) => c.key === 'competitor') ? competitorRank : null,
  }

  if (usable.length === 0 || totalWeight === 0) {
    return {
      rank: clampRank(occupancyRank, maxRank),
      components: { occupancy: occupancyRank, adr: null, competitor: null },
      effectiveWeights: OCCUPANCY_ONLY_WEIGHTS,
    }
  }

  const weighted = usable.reduce((sum, c) => sum + c.rank * c.weight, 0) / totalWeight

  return {
    rank: clampRank(Math.round(weighted), maxRank),
    components,
    effectiveWeights: {
      weightOccupancy: effectiveWeight(usable, 'occupancy', totalWeight),
      weightAdr: effectiveWeight(usable, 'adr', totalWeight),
      weightCompetitor: effectiveWeight(usable, 'competitor', totalWeight),
    },
  }
}

function effectiveWeight(
  usable: { key: string; weight: number }[],
  key: string,
  totalWeight: number
): number {
  const found = usable.find((c) => c.key === key)
  if (!found) return 0
  return Math.round((found.weight / totalWeight) * 100)
}

function clampRank(rank: number, maxRank: number): number {
  return Math.min(maxRank, Math.max(1, rank))
}

// ======================================
// ガードレール（#17）
// ======================================

export interface RankGuardrails {
  /** 推奨ランクの下限・上限（null は料金ランクの全範囲） */
  minRank: number | null
  maxRank: number | null
  /** 前回の推奨から1回で動かせるランク数（null は制限なし） */
  maxDailyRankChange: number | null
  /** 前回の推奨との差がこれ以内なら据え置く（0 は常に更新） */
  hysteresisRanks: number
}

export type GuardrailKey = 'minRank' | 'maxRank' | 'maxDailyChange' | 'hysteresis'

export interface GuardrailResult {
  rank: number
  applied: Array<{ key: GuardrailKey; from: number; to: number }>
}

/**
 * 加重平均で出したランクにガードレールをかける。順序:
 *   1. ヒステリシス（前回との差が小さければ前回のまま）
 *   2. 1回あたりの変動幅（前回から maxDailyRankChange を超えて動かさない）
 *   3. 下限・上限（最後に必ず範囲へ収める）
 * 前回の推奨が無い日（初回）は 3 だけをかける。
 */
export function applyRankGuardrails(params: {
  rank: number
  previousRank: number | null
  guardrails: RankGuardrails
  maxRank: number
}): GuardrailResult {
  const { previousRank, guardrails } = params
  const applied: GuardrailResult['applied'] = []
  let rank = params.rank

  if (previousRank != null) {
    const diff = rank - previousRank
    if (diff !== 0 && Math.abs(diff) <= guardrails.hysteresisRanks) {
      applied.push({ key: 'hysteresis', from: rank, to: previousRank })
      rank = previousRank
    } else if (guardrails.maxDailyRankChange != null && Math.abs(diff) > guardrails.maxDailyRankChange) {
      const limited = previousRank + Math.sign(diff) * guardrails.maxDailyRankChange
      applied.push({ key: 'maxDailyChange', from: rank, to: limited })
      rank = limited
    }
  }

  const lower = Math.max(1, guardrails.minRank ?? 1)
  const upper = Math.min(params.maxRank, guardrails.maxRank ?? params.maxRank)
  if (rank < lower) {
    applied.push({ key: 'minRank', from: rank, to: lower })
    rank = lower
  } else if (rank > upper) {
    applied.push({ key: 'maxRank', from: rank, to: upper })
    rank = upper
  }

  return { rank, applied }
}

/** 競合と比べる人数（#17）。未設定ならホテルタイプから決める: 宿泊特化=1名、それ以外=2名、タイプ未設定=1名 */
export function resolveCompetitorOccupancy(configured: number | null | undefined, hotelType: string | null | undefined): 1 | 2 {
  if (configured === 1 || configured === 2) return configured
  if (hotelType == null || hotelType === 'LIMITED_SERVICE') return 1
  return 2
}
