import { meanAbsoluteError } from '../evaluation.js'
import type { Trainer } from './types.js'

// ======================================
// リッジ回帰（4E-2 — docs/ai-agent-design.md §2）
//
// 学習データが数百〜数千行しかない状況では、正則化した線形モデルが
// 木モデルに肩を並べる（あるいは勝つ）ことが珍しくない。実装も検証も軽い。
//
// 正規方程式 (XᵀX + λI)w = Xᵀy をガウス消去で解く。
// 特徴量は25個なので 26×26 の連立方程式にすぎず、数値計算ライブラリは要らない。
// ======================================

export interface RidgeParams {
  /** 切片。標準化の影響を受けないよう別に持つ */
  intercept: number
  /** 標準化後の空間での係数 */
  weights: number[]
  /** 学習時の各特徴量の平均 */
  mean: number[]
  /** 学習時の各特徴量の標準偏差（0の列は1に置換） */
  std: number[]
  /** 選ばれた正則化強度 */
  lambda: number
}

/**
 * 正則化強度の候補。小さすぎると過学習、大きすぎると平均予測に潰れる。
 * どれが良いかはデータ次第なので、検証誤差で選ばせる。
 */
const LAMBDA_GRID = [0.01, 0.1, 0.3, 1, 3, 10, 30, 100]

/** 学習に必要な最小サンプル数。特徴量数を下回ると解が定まらない */
const MIN_SAMPLES = 30

/**
 * 列ごとに平均0・分散1へそろえる。
 * 正則化は「係数の大きさ」に罰を与えるので、スケールがバラバラだと
 * たまたま値の小さい特徴量ばかりが強く罰せられてしまう。
 */
export function standardize(rows: number[][]): { mean: number[]; std: number[] } {
  const columns = rows[0]?.length ?? 0
  const mean = new Array<number>(columns).fill(0)
  const std = new Array<number>(columns).fill(0)

  for (const row of rows) {
    for (let j = 0; j < columns; j += 1) mean[j] += row[j]
  }
  for (let j = 0; j < columns; j += 1) mean[j] /= rows.length

  for (const row of rows) {
    for (let j = 0; j < columns; j += 1) {
      const diff = row[j] - mean[j]
      std[j] += diff * diff
    }
  }
  for (let j = 0; j < columns; j += 1) {
    const variance = std[j] / rows.length
    // 定数列（分散0）は割り算で壊れるので1に倒す。係数は0に落ち着く
    std[j] = variance > 1e-12 ? Math.sqrt(variance) : 1
  }

  return { mean, std }
}

function applyStandardization(row: number[], mean: number[], std: number[]): number[] {
  return row.map((v, j) => (v - mean[j]) / std[j])
}

/**
 * 対称正定値行列の連立方程式をガウス消去（部分ピボット選択つき）で解く。
 * 解けない場合は null（呼び出し側が別のλへフォールバックする）。
 */
export function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length
  // 破壊的に消去するので複製する
  const a = matrix.map((row, i) => [...row, vector[i]])

  for (let col = 0; col < n; col += 1) {
    // 部分ピボット選択。絶対値最大の行を持ってきて数値誤差を抑える
    let pivotRow = col
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivotRow][col])) pivotRow = row
    }
    if (Math.abs(a[pivotRow][col]) < 1e-12) return null // 特異行列
    if (pivotRow !== col) {
      const tmp = a[col]
      a[col] = a[pivotRow]
      a[pivotRow] = tmp
    }

    const pivot = a[col][col]
    for (let row = col + 1; row < n; row += 1) {
      const factor = a[row][col] / pivot
      if (factor === 0) continue
      for (let k = col; k <= n; k += 1) a[row][k] -= factor * a[col][k]
    }
  }

  const solution = new Array<number>(n).fill(0)
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = a[row][n]
    for (let k = row + 1; k < n; k += 1) sum -= a[row][k] * solution[k]
    solution[row] = sum / a[row][row]
  }
  return solution.every((v) => Number.isFinite(v)) ? solution : null
}

/** 指定のλで係数を求める（標準化済みの入力を前提とする） */
function fitWeights(x: number[][], y: number[], lambda: number): number[] | null {
  const columns = x[0].length
  // XᵀX + λI
  const xtx: number[][] = Array.from({ length: columns }, () =>
    new Array<number>(columns).fill(0)
  )
  const xty = new Array<number>(columns).fill(0)

  for (let i = 0; i < x.length; i += 1) {
    const row = x[i]
    for (let j = 0; j < columns; j += 1) {
      xty[j] += row[j] * y[i]
      for (let k = j; k < columns; k += 1) {
        xtx[j][k] += row[j] * row[k]
      }
    }
  }
  // 対称性を使って下三角を埋める（計算量を半分にするため上三角だけ回した）
  for (let j = 0; j < columns; j += 1) {
    for (let k = j + 1; k < columns; k += 1) xtx[k][j] = xtx[j][k]
    xtx[j][j] += lambda
  }

  return solveLinearSystem(xtx, xty)
}

function predictStandardized(params: RidgeParams, features: number[]): number {
  const z = applyStandardization(features, params.mean, params.std)
  let sum = params.intercept
  for (let j = 0; j < params.weights.length; j += 1) sum += params.weights[j] * z[j]
  return sum
}

export const ridgeTrainer: Trainer = {
  algorithm: 'ridge',

  train(train, validation) {
    if (train.length < MIN_SAMPLES || validation.length === 0) return null

    const x = train.map((s) => s.features)
    const y = train.map((s) => s.target)
    const { mean, std } = standardize(x)
    const xz = x.map((row) => applyStandardization(row, mean, std))
    // 切片は「目的変数の平均」。標準化済みなので中心化するだけでよい
    const intercept = y.reduce((a, b) => a + b, 0) / y.length
    const yCentered = y.map((v) => v - intercept)

    let best: { params: RidgeParams; mae: number } | null = null
    for (const lambda of LAMBDA_GRID) {
      const weights = fitWeights(xz, yCentered, lambda)
      if (!weights) continue

      const params: RidgeParams = { intercept, weights, mean, std, lambda }
      const predicted = validation.map((s) => predictStandardized(params, s.features))
      const mae = meanAbsoluteError(
        predicted,
        validation.map((s) => s.target)
      )
      if (!best || mae < best.mae) best = { params, mae }
    }
    if (!best) return null

    // 寄与度は標準化空間での係数の絶対値（スケールがそろっているので比較できる）
    const magnitude = best.params.weights.map((w) => Math.abs(w))
    const total = magnitude.reduce((a, b) => a + b, 0)
    const featureImportance = total > 0 ? magnitude.map((m) => m / total) : magnitude.map(() => 0)

    return {
      algorithm: 'ridge',
      sampleCount: train.length,
      validationMae: best.mae,
      featureImportance,
      params: best.params,
    }
  },

  predict(model, features) {
    return predictStandardized(model.params as RidgeParams, features)
  },
}
