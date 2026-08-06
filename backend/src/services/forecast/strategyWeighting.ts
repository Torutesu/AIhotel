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
//   - 競合観点  : 対象日の競合平均価格に見合うランク（競合に価格を追随させる）
//
// データが存在しない観点は合成から除外し、その重みを残りの観点へ按分する。
// 競合価格が未取得の日に「競合ランク=0」として引き下げてしまうことを防ぐため。
//
// ※ 各観点をランクへ写像する方式そのものは要確認事項（基本設計書 Q-10）であり、
//   確定後に係数・写像方法を見直す前提の初版実装である。

const DEFAULT_ADR_WINDOW_DAYS = 28

export interface StrategyWeights {
  weightOccupancy: number
  weightAdr: number
  weightCompetitor: number
}

/** 料金ランクと1名料金の対応（PriceRank 由来） */
export interface RankPrice {
  rank: number
  price1P: number
}

export interface AdrRecord {
  date: Date
  adr: number
}

export interface CompetitorPriceRecord {
  date: Date
  price1P: number
}

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
    const diff = Math.abs(r.price1P - price)
    if (best === null || diff < best.diff || (diff === best.diff && r.rank < best.rank)) {
      best = { rank: r.rank, diff }
    }
  }
  return best?.rank ?? null
}

/**
 * 直近 windowDays 以内の同曜日ADR実績の平均に対応するランク。
 * 同曜日の実績が無ければ窓内の全実績平均にフォールバックし、
 * それも無ければ null（ADR観点を合成から除外）。
 */
export function computeAdrRank(
  history: AdrRecord[],
  targetDate: Date,
  ranks: RankPrice[],
  windowDays = DEFAULT_ADR_WINDOW_DAYS
): number | null {
  if (ranks.length === 0) return null

  const windowStart = new Date(targetDate)
  windowStart.setUTCDate(windowStart.getUTCDate() - windowDays)

  const inWindow = history.filter((h) => h.date >= windowStart && h.date < targetDate)
  if (inWindow.length === 0) return null

  const sameWeekday = inWindow.filter((h) => h.date.getUTCDay() === targetDate.getUTCDay())
  const source = sameWeekday.length > 0 ? sameWeekday : inWindow

  const averageAdr = source.reduce((sum, h) => sum + h.adr, 0) / source.length
  return mapPriceToRank(averageAdr, ranks)
}

/**
 * 対象日の競合平均価格に対応するランク。
 * 対象日の競合価格が1件も無ければ null（競合観点を合成から除外）。
 */
export function computeCompetitorRank(
  prices: CompetitorPriceRecord[],
  targetDate: Date,
  ranks: RankPrice[]
): number | null {
  if (ranks.length === 0) return null

  const sameDay = prices.filter((p) => p.date.getTime() === targetDate.getTime())
  if (sameDay.length === 0) return null

  const average = sameDay.reduce((sum, p) => sum + p.price1P, 0) / sameDay.length
  return mapPriceToRank(average, ranks)
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
