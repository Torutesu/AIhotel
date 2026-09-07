// 価格決定層（docs/外部要因設計.md §2.2）。DB 非依存の純粋ロジック。
//
// 需要予測 D → 基準ランク r_D → 3つの候補ランク（稼働率重視 / ADR重視 / 競合追従）を
// 価格戦略の重み（F-DP-02、合計100%）で合成し、ガードレールを通して最終ランクを決める。
// 各ステップの寄与を contributions として返し、UI がそのまま表示できるようにする。
import { buildPriceResponse, occupancyAt, revParAt, type PriceResponseModel } from './priceResponse.js'

export interface RankPrice {
  rank: number
  price1P: number
}

export interface StrategyWeights {
  weightOccupancy: number
  weightAdr: number
  weightCompetitor: number
}

export interface Guardrails {
  minRank: number
  maxRank: number
  /** 参照ランク（適用中ランク or 前回推奨）からの最大変動幅。null なら制限なし */
  maxDailyRankChange: number | null
  /** 競合中央値に対するポジション（%）。+5 = 競合より5%高く */
  competitorPositionPct: number
}

export interface RankDecisionInput {
  /** 予測稼働率（0〜1 に clamp 済み）。基準ランクの決定に使う */
  predictedOccupancy: number
  /** clamp 前の予測稼働率（1 を超えうる）。価格反応モデルの潜在需要に使う。満室予測時の値上げ余地がここから出る */
  unconstrainedOccupancy: number
  ranks: RankPrice[]
  weights: StrategyWeights
  guardrails: Guardrails
  /** 競合価格の中央値（1名利用）。データが無ければ null（中立扱い） */
  competitorMedianPrice: number | null
  /** 適用中のランク（採否記録）。無ければ null */
  currentRank: number | null
  /** 前回の推奨ランク。currentRank が無いときの変動幅の参照に使う */
  previousRecommendedRank: number | null
  /** 価格反応モデルの σ（'price:sigma'） */
  sigma: number
  /** 稼働率重視候補: 収益最大値からこの割合まで RevPAR を犠牲にして最も低いランクを選ぶ（'strategy:occ_revpar_tolerance'） */
  occupancyRevParTolerance: number
  /** ADR重視候補: 収益最大値からこの割合まで RevPAR を犠牲にして最も高いランクを選ぶ（'strategy:adr_revpar_tolerance'） */
  adrRevParTolerance: number
}

export interface RankContribution {
  key: string
  label: string
  /** 基準ランク（key=base）ではランク値そのもの、それ以外は増減 */
  rank?: number
  delta?: number
  detail?: string
}

export interface RankDecision {
  rank: number
  baseRank: number
  /** 価格反応モデル上の収益最大ランク */
  revenueOptimalRank: number
  candidates: { occupancy: number; adr: number; competitor: number | null }
  contributions: RankContribution[]
  /** 比較対象のランク（currentRank ?? previousRecommendedRank ?? baseRank） */
  comparisonRank: number
  expectedRevParCurrent: number
  expectedRevParRecommended: number
  expectedOccupancyRecommended: number
  model: PriceResponseModel
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/**
 * 予測稼働率を基準ランク（1〜maxRank）にマップする（rule-based-v1 と同じ線形写像）
 */
export function mapOccupancyToBaseRank(occupancy: number, maxRank: number): number {
  return clamp(Math.round(occupancy * maxRank), 1, maxRank)
}

function priceOf(ranks: RankPrice[], rank: number): number | null {
  return ranks.find((r) => r.rank === rank)?.price1P ?? null
}

function nearestRankByPrice(ranks: RankPrice[], targetPrice: number): number {
  let best = ranks[0]
  for (const r of ranks) {
    if (Math.abs(r.price1P - targetPrice) < Math.abs(best.price1P - targetPrice)) best = r
  }
  return best.rank
}

/**
 * 最終ランクとその理由分解を計算する
 */
export function decideRank(input: RankDecisionInput): RankDecision {
  const ranks = [...input.ranks].sort((a, b) => a.rank - b.rank)
  if (ranks.length === 0) throw new Error('料金ランクが未設定です')
  const tableMax = ranks[ranks.length - 1].rank
  const D = clamp(input.predictedOccupancy, 0, 1)

  // ---- 基準ランクと価格反応モデル
  const baseRank = mapOccupancyToBaseRank(D, tableMax)
  const referencePrice = priceOf(ranks, baseRank) ?? ranks[Math.min(baseRank, ranks.length) - 1].price1P
  const model = buildPriceResponse(referencePrice, Math.max(D, input.unconstrainedOccupancy), input.sigma)

  // ---- 収益最大ランク（需要が弱ければ基準ランク、潜在需要が客室数を超えていれば満室を保てる範囲で上）
  const revParByRank = new Map(ranks.map((r) => [r.rank, revParAt(model, r.price1P)]))
  let revenueOptimalRank = baseRank
  let bestRevPar = -1
  for (const r of ranks) {
    const rp = revParByRank.get(r.rank)!
    if (rp > bestRevPar + 1e-9) {
      bestRevPar = rp
      revenueOptimalRank = r.rank
    }
  }

  // ---- 候補1: ADR重視 = 収益最大値の (1 - 許容) 以上を保つ最も高いランク（レート維持を優先）
  let adrRank = revenueOptimalRank
  for (const r of ranks) {
    if (r.rank > adrRank && revParByRank.get(r.rank)! >= bestRevPar * (1 - input.adrRevParTolerance)) adrRank = r.rank
  }

  // ---- 候補2: 稼働率重視 = 収益最大値の (1 - 許容) 以上を保つ最も低いランク（客室を埋めることを優先）
  let occRank = revenueOptimalRank
  for (const r of ranks) {
    if (r.rank < occRank && revParByRank.get(r.rank)! >= bestRevPar * (1 - input.occupancyRevParTolerance)) occRank = r.rank
  }

  // ---- 候補3: 競合追従 = 競合中央値 × ポジションに最も近いランク。データが無ければ基準（中立）
  const competitorRank =
    input.competitorMedianPrice != null && input.competitorMedianPrice > 0
      ? nearestRankByPrice(ranks, input.competitorMedianPrice * (1 + input.guardrails.competitorPositionPct / 100))
      : null

  // ---- 重み付け合成
  const { weightOccupancy, weightAdr, weightCompetitor } = input.weights
  const totalWeight = weightOccupancy + weightAdr + weightCompetitor || 100
  const compForBlend = competitorRank ?? baseRank
  const blended =
    (weightOccupancy * occRank + weightAdr * adrRank + weightCompetitor * compForBlend) / totalWeight
  const blendedRank = Math.round(blended)

  // ---- ガードレール
  const reference = input.currentRank ?? input.previousRecommendedRank
  let finalRank = clamp(blendedRank, input.guardrails.minRank, input.guardrails.maxRank)
  finalRank = clamp(finalRank, ranks[0].rank, tableMax)
  if (reference != null && input.guardrails.maxDailyRankChange != null) {
    finalRank = clamp(finalRank, reference - input.guardrails.maxDailyRankChange, reference + input.guardrails.maxDailyRankChange)
    finalRank = clamp(finalRank, ranks[0].rank, tableMax)
  }

  // ---- 理由分解（ランク単位）。合計が finalRank になるように丸め誤差とガードレールを明示する
  const contributions: RankContribution[] = [
    { key: 'base', label: '基準ランク（需要予測）', rank: baseRank, detail: `予測稼働率 ${(D * 100).toFixed(0)}%` },
  ]
  const occDelta = (weightOccupancy / totalWeight) * (occRank - baseRank)
  const adrDelta = (weightAdr / totalWeight) * (adrRank - baseRank)
  const compDelta = (weightCompetitor / totalWeight) * (compForBlend - baseRank)
  contributions.push({
    key: 'occupancy',
    label: `稼働率重視（${weightOccupancy}%）`,
    delta: occDelta,
    detail: `候補 R${occRank}（収益最大 R${revenueOptimalRank} から RevPAR −${(input.occupancyRevParTolerance * 100).toFixed(0)}% 以内で最も低いランク）`,
  })
  contributions.push({
    key: 'adr',
    label: `ADR重視（${weightAdr}%）`,
    delta: adrDelta,
    detail: `候補 R${adrRank}（収益最大 R${revenueOptimalRank} から RevPAR −${(input.adrRevParTolerance * 100).toFixed(0)}% 以内で最も高いランク）`,
  })
  contributions.push({
    key: 'competitor',
    label: `競合追従（${weightCompetitor}%）`,
    delta: compDelta,
    detail:
      competitorRank != null
        ? `候補 R${competitorRank}（競合中央値 ¥${Math.round(input.competitorMedianPrice!).toLocaleString('ja-JP')}${input.guardrails.competitorPositionPct ? ` の ${input.guardrails.competitorPositionPct > 0 ? '+' : ''}${input.guardrails.competitorPositionPct}%` : ''}）`
        : '競合価格データなし（中立）',
  })
  const roundingDelta = blendedRank - blended
  if (Math.abs(roundingDelta) > 1e-9) {
    contributions.push({ key: 'rounding', label: '端数処理', delta: roundingDelta })
  }
  const guardDelta = finalRank - blendedRank
  if (guardDelta !== 0) {
    contributions.push({
      key: 'guardrail',
      label: 'ガードレール',
      delta: guardDelta,
      detail:
        reference != null && Math.abs(blendedRank - reference) > (input.guardrails.maxDailyRankChange ?? Infinity)
          ? `1回の最大変動 ±${input.guardrails.maxDailyRankChange}（参照 R${reference}）`
          : `ランク範囲 R${input.guardrails.minRank}〜R${input.guardrails.maxRank}`,
    })
  }

  // ---- 期待 RevPAR（比較対象 = 適用中ランク → 前回推奨 → 基準）
  const comparisonRank = clamp(reference ?? baseRank, ranks[0].rank, tableMax)
  const comparisonPrice = priceOf(ranks, comparisonRank) ?? referencePrice
  const finalPrice = priceOf(ranks, finalRank) ?? referencePrice

  return {
    rank: finalRank,
    baseRank,
    revenueOptimalRank,
    candidates: { occupancy: occRank, adr: adrRank, competitor: competitorRank },
    contributions,
    comparisonRank,
    expectedRevParCurrent: Math.round(revParAt(model, comparisonPrice)),
    expectedRevParRecommended: Math.round(revParAt(model, finalPrice)),
    expectedOccupancyRecommended: occupancyAt(model, finalPrice),
    model,
  }
}
