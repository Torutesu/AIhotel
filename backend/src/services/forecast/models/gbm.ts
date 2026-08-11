import { meanAbsoluteError } from '../evaluation.js'
import type { Trainer } from './types.js'

// ======================================
// 勾配ブースティング回帰木（4E-2 — docs/ai-agent-design.md §2）
//
// 仕様書が挙げる「勾配ブースティング系」を、外部ライブラリ無しで実装する。
// 特徴量25個・サンプル数千という規模では、これで十分に速く動く
// （学習は数百ミリ秒）。Python サイドカーを立てる必要が無い理由でもある。
//
// 二乗損失なので、各段の木は「それまでの予測の残差」を当てにいく。
// 過学習しやすいので、浅い木・小さい学習率・検証データによる早期終了で抑える。
// ======================================

/** 木のノード。葉なら value、内部ノードなら分岐条件を持つ */
export interface TreeNode {
  /** 葉の予測値。内部ノードでは undefined */
  value?: number
  /** 分岐に使う特徴量の位置 */
  featureIndex?: number
  /** この値以下なら左、超えるなら右 */
  threshold?: number
  left?: TreeNode
  right?: TreeNode
}

export interface GbmParams {
  /** 初期値（目的変数の平均） */
  baseValue: number
  learningRate: number
  trees: TreeNode[]
}

const LEARNING_RATE = 0.05
/** 木の最大本数。早期終了で実際にはこれより少なくなることが多い */
const MAX_TREES = 300
/** 木の深さ。深くすると数百行のデータでは即座に過学習する */
const MAX_DEPTH = 3
/** 葉に必要な最小サンプル数。小さすぎるとノイズを覚える */
const MIN_SAMPLES_LEAF = 10
/** 検証誤差がこの回数連続で改善しなければ打ち切る */
const EARLY_STOPPING_ROUNDS = 20
/** 分岐点の候補数。全値を試さず分位点で刻む（速度と過学習の両方に効く） */
const SPLIT_CANDIDATES = 16
const MIN_SAMPLES = 50

interface SplitCandidate {
  featureIndex: number
  threshold: number
  /** 分割による二乗誤差の減少量 */
  gain: number
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

/** 分割前後の二乗誤差の差。大きいほど良い分割 */
function sumSquaredError(values: number[]): number {
  if (values.length === 0) return 0
  const m = mean(values)
  return values.reduce((sum, v) => sum + (v - m) * (v - m), 0)
}

/**
 * 分岐点の候補を分位点で作る。
 * 連続値の全ユニーク値を試すと候補が数千になり、遅いうえに
 * 「たまたま1点だけ切れる」分割を選びやすくなる。
 */
function thresholdCandidates(values: number[]): number[] {
  const sorted = [...new Set(values)].sort((a, b) => a - b)
  if (sorted.length <= 1) return []
  if (sorted.length <= SPLIT_CANDIDATES) {
    // 隣り合う値の中点を使う（値そのものを閾値にすると片側に偏る）
    return sorted.slice(0, -1).map((v, i) => (v + sorted[i + 1]) / 2)
  }
  const step = sorted.length / (SPLIT_CANDIDATES + 1)
  const candidates: number[] = []
  for (let i = 1; i <= SPLIT_CANDIDATES; i += 1) {
    const index = Math.min(sorted.length - 2, Math.floor(i * step))
    candidates.push((sorted[index] + sorted[index + 1]) / 2)
  }
  return [...new Set(candidates)]
}

function findBestSplit(rows: number[][], targets: number[]): SplitCandidate | null {
  const parentError = sumSquaredError(targets)
  const featureCount = rows[0].length
  let best: SplitCandidate | null = null

  for (let featureIndex = 0; featureIndex < featureCount; featureIndex += 1) {
    const column = rows.map((r) => r[featureIndex])
    for (const threshold of thresholdCandidates(column)) {
      const leftTargets: number[] = []
      const rightTargets: number[] = []
      for (let i = 0; i < rows.length; i += 1) {
        if (column[i] <= threshold) leftTargets.push(targets[i])
        else rightTargets.push(targets[i])
      }
      if (leftTargets.length < MIN_SAMPLES_LEAF || rightTargets.length < MIN_SAMPLES_LEAF) continue

      const gain = parentError - (sumSquaredError(leftTargets) + sumSquaredError(rightTargets))
      if (gain > 0 && (!best || gain > best.gain)) {
        best = { featureIndex, threshold, gain }
      }
    }
  }
  return best
}

export function buildTree(
  rows: number[][],
  targets: number[],
  depth = 0,
  importance?: number[]
): TreeNode {
  if (depth >= MAX_DEPTH || rows.length < MIN_SAMPLES_LEAF * 2) {
    return { value: mean(targets) }
  }

  const split = findBestSplit(rows, targets)
  if (!split) return { value: mean(targets) }

  if (importance) importance[split.featureIndex] += split.gain

  const leftRows: number[][] = []
  const leftTargets: number[] = []
  const rightRows: number[][] = []
  const rightTargets: number[] = []
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i][split.featureIndex] <= split.threshold) {
      leftRows.push(rows[i])
      leftTargets.push(targets[i])
    } else {
      rightRows.push(rows[i])
      rightTargets.push(targets[i])
    }
  }

  return {
    featureIndex: split.featureIndex,
    threshold: split.threshold,
    left: buildTree(leftRows, leftTargets, depth + 1, importance),
    right: buildTree(rightRows, rightTargets, depth + 1, importance),
  }
}

export function predictTree(node: TreeNode, features: number[]): number {
  let current = node
  // 葉に着くまで降りる
  while (current.value === undefined) {
    const goLeft = features[current.featureIndex!] <= current.threshold!
    const next = goLeft ? current.left : current.right
    if (!next) return 0 // 壊れた木。0を返して呼び出し側の合計を壊さない
    current = next
  }
  return current.value
}

function predictWithParams(params: GbmParams, features: number[]): number {
  let sum = params.baseValue
  for (const tree of params.trees) {
    sum += params.learningRate * predictTree(tree, features)
  }
  return sum
}

export const gbmTrainer: Trainer = {
  algorithm: 'gbm',

  train(train, validation) {
    if (train.length < MIN_SAMPLES || validation.length === 0) return null

    const rows = train.map((s) => s.features)
    const targets = train.map((s) => s.target)
    const validationRows = validation.map((s) => s.features)
    const validationTargets = validation.map((s) => s.target)

    const baseValue = mean(targets)
    const trees: TreeNode[] = []
    const importance = new Array<number>(rows[0].length).fill(0)

    // 予測値を逐次更新していく（毎回全木を評価し直さない）
    const trainPredictions = new Array<number>(rows.length).fill(baseValue)
    const validationPredictions = new Array<number>(validationRows.length).fill(baseValue)

    let bestMae = Number.POSITIVE_INFINITY
    let bestTreeCount = 0
    let roundsWithoutImprovement = 0

    for (let iteration = 0; iteration < MAX_TREES; iteration += 1) {
      // 二乗損失の負の勾配 = 残差
      const residuals = targets.map((t, i) => t - trainPredictions[i])
      const tree = buildTree(rows, residuals, 0, importance)
      trees.push(tree)

      for (let i = 0; i < rows.length; i += 1) {
        trainPredictions[i] += LEARNING_RATE * predictTree(tree, rows[i])
      }
      for (let i = 0; i < validationRows.length; i += 1) {
        validationPredictions[i] += LEARNING_RATE * predictTree(tree, validationRows[i])
      }

      const mae = meanAbsoluteError(validationPredictions, validationTargets)
      if (mae < bestMae - 1e-6) {
        bestMae = mae
        bestTreeCount = trees.length
        roundsWithoutImprovement = 0
      } else {
        roundsWithoutImprovement += 1
        // 改善が止まったら打ち切る。以降は過学習が進むだけ
        if (roundsWithoutImprovement >= EARLY_STOPPING_ROUNDS) break
      }
    }

    if (bestTreeCount === 0) return null

    const totalGain = importance.reduce((a, b) => a + b, 0)
    const featureImportance =
      totalGain > 0 ? importance.map((g) => g / totalGain) : importance.map(() => 0)

    return {
      algorithm: 'gbm',
      sampleCount: train.length,
      validationMae: bestMae,
      featureImportance,
      params: {
        baseValue,
        learningRate: LEARNING_RATE,
        // 検証誤差が最小だった時点まで戻す（早期終了後の木は捨てる）
        trees: trees.slice(0, bestTreeCount),
      } satisfies GbmParams,
    }
  },

  predict(model, features) {
    return predictWithParams(model.params as GbmParams, features)
  },
}
