// 推奨ランク選定（P-2 / docs/algorithm-design.md §3.3）。
//
// 需要予測（ruleBasedForecaster）が出すベースラインランクの近傍を候補とし、
// PricingStrategyConfig の重み（稼働率/ADR/競合追従、合計100%）でスコアリング
// して最終的な推奨ランクを選ぶ。これにより F-DP-02 の重み設定が実際に
// 推奨価格へ反映される。
//
// 候補価格での期待稼働率は仮定弾力性による近似（v1.5の暫定値）。
// v2 で需要曲線（打ち切り補正済み実績から推定した価格弾力性）に置き換える。
// DB非依存の純粋ロジックのみを置くこと（テスト容易性のため）。

/** 仮定価格弾力性（暫定値）: 価格+10%で需要-8%相当。v2で学習値に置換 */
export const ASSUMED_PRICE_ELASTICITY = -0.8

/** ベースラインからの探索幅（±3ランク）。急変防止を兼ねる */
export const CANDIDATE_RANK_WINDOW = 3

export interface StrategyWeights {
  weightOccupancy: number
  weightAdr: number
  weightCompetitor: number
}

/** PricingStrategyConfig 未設定時の既定重み（スキーマのデフォルトと同値） */
export const DEFAULT_STRATEGY_WEIGHTS: StrategyWeights = {
  weightOccupancy: 40,
  weightAdr: 40,
  weightCompetitor: 20,
}

/**
 * 候補価格での期待稼働率（定弾力性近似）。
 * occ(p) = baseOcc * (p / basePrice)^elasticity を [0,1] にclamp
 */
export function estimateOccupancyAtPrice(
  baseOccupancy: number,
  basePrice: number,
  price: number,
  elasticity = ASSUMED_PRICE_ELASTICITY
): number {
  if (basePrice <= 0 || price <= 0) return baseOccupancy
  const estimated = baseOccupancy * (price / basePrice) ** elasticity
  return Math.min(1, Math.max(0, estimated))
}

export interface SelectRankParams {
  /** 需要予測から得たベースラインランク（重み適用前） */
  baselineRank: number
  /** ベースラインランクでの予測稼働率 */
  predictedOccupancy: number
  /** rank → price1P（PriceRank マスタ。isActive のみ） */
  priceByRank: Map<number, number>
  weights: StrategyWeights
  /** 対象日の競合平均価格（データがなければ null → 競合重みは稼働/ADRへ再配分） */
  competitorAvgPrice: number | null
  maxRank: number
}

export interface SelectRankResult {
  rank: number
  price: number | null
}

/**
 * 価格戦略の重みで候補ランクをスコアリングし推奨ランクを選ぶ。
 *
 * score(r) = w_occ * 稼働スコア(r) + w_adr * ADRスコア(r) + w_comp * 競合スコア(r)
 * - 稼働スコア: 仮定弾力性による期待稼働率（安いほど高い）
 * - ADRスコア: 価格（高いほど高い）
 * - 競合スコア: 競合平均への近接度 1 - |price - 競合平均| / 競合平均
 * 各スコアは候補内で min-max 正規化して [0,1] に揃える（次元間のスケール差で
 * 特定の重みだけが実質無効になるのを防ぐ）。差がない次元は一律0.5
 * - 競合データがない日は w_comp を除外し残り重みで正規化（サイレントに0点扱いしない）
 * - 同点はベースラインに近いランク（さらに同点なら低いランク=保守側）を選ぶ
 */
export function selectRecommendedRank(params: SelectRankParams): SelectRankResult {
  const { baselineRank, predictedOccupancy, priceByRank, weights, competitorAvgPrice, maxRank } = params

  const basePrice = priceByRank.get(baselineRank)
  if (basePrice == null || basePrice <= 0) {
    // 価格マスタが引けない場合は重み適用不能 → ベースラインを維持
    return { rank: baselineRank, price: basePrice ?? null }
  }

  const candidates: { rank: number; price: number }[] = []
  for (
    let rank = Math.max(1, baselineRank - CANDIDATE_RANK_WINDOW);
    rank <= Math.min(maxRank, baselineRank + CANDIDATE_RANK_WINDOW);
    rank++
  ) {
    const price = priceByRank.get(rank)
    if (price != null && price > 0) candidates.push({ rank, price })
  }
  if (candidates.length === 0) return { rank: baselineRank, price: basePrice }

  // 競合データの有無で有効重みを決める（合計が0なら選定不能 → ベースライン維持）
  const useCompetitor = competitorAvgPrice != null && competitorAvgPrice > 0
  const wOcc = weights.weightOccupancy
  const wAdr = weights.weightAdr
  const wComp = useCompetitor ? weights.weightCompetitor : 0
  const totalWeight = wOcc + wAdr + wComp
  if (totalWeight <= 0) return { rank: baselineRank, price: basePrice }

  // 各次元の生スコアを算出し、候補内 min-max で [0,1] に正規化する
  const normalize = (values: number[]): number[] => {
    const min = Math.min(...values)
    const max = Math.max(...values)
    const spread = max - min
    return values.map((v) => (spread > 0 ? (v - min) / spread : 0.5))
  }

  const occScores = normalize(
    candidates.map((c) => estimateOccupancyAtPrice(predictedOccupancy, basePrice, c.price))
  )
  const adrScores = normalize(candidates.map((c) => c.price))
  const compScores = useCompetitor
    ? normalize(
        candidates.map((c) => 1 - Math.abs(c.price - competitorAvgPrice) / competitorAvgPrice)
      )
    : candidates.map(() => 0)

  let best: { rank: number; price: number; score: number } | null = null
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    const score = (wOcc * occScores[i] + wAdr * adrScores[i] + wComp * compScores[i]) / totalWeight

    if (
      best == null ||
      score > best.score + 1e-9 ||
      (Math.abs(score - best.score) <= 1e-9 &&
        (Math.abs(c.rank - baselineRank) < Math.abs(best.rank - baselineRank) ||
          (Math.abs(c.rank - baselineRank) === Math.abs(best.rank - baselineRank) && c.rank < best.rank)))
    ) {
      best = { rank: c.rank, price: c.price, score }
    }
  }

  return { rank: best!.rank, price: best!.price }
}
