// オンライン Ridge 回帰（docs/外部要因設計.md §5.2 L2）。DB 非依存の純粋ロジック。
//
// 十分統計量 XᵀX, Xᵀy を保持し、サンプルが来るたびに加算（オンライン）。
// 予測時は (XᵀX + λI)⁻¹ Xᵀy を解いて重みを得る。特徴量は rule-based-v2 の要因分解
// （base・pace・各要因の pt）と曜日ダミーで、ルールベースの構造を保ったまま
// 「各要因をどれだけ信じるか」を実績から学ぶ。サンプルが少ないうちは prior
// （ルールベースと同じ重み = 1）へ縮小する。

export const RIDGE_FEATURE_KEYS = [
  'bias',
  'base',
  'pace',
  'holiday',
  'special',
  'school',
  'event',
  'weather',
  'weekend',
  'comp',
  'dow0',
  'dow1',
  'dow2',
  'dow3',
  'dow4',
  'dow5',
  'dow6',
] as const

export type RidgeFeatureKey = (typeof RIDGE_FEATURE_KEYS)[number]
export const RIDGE_DIM = RIDGE_FEATURE_KEYS.length

/** 要因キー（factorDefaults）を特徴量グループにまとめる */
export function factorGroup(key: string): RidgeFeatureKey | null {
  if (key === 'base' || key === 'pace') return key
  const prefix = key.split(':')[0]
  switch (prefix) {
    case 'holiday':
      return 'holiday'
    case 'special':
      return 'special'
    case 'school':
      return 'school'
    case 'event':
      return 'event'
    case 'weather':
      return 'weather'
    case 'weekend':
      return 'weekend'
    case 'comp':
      return 'comp'
    default:
      return null
  }
}

export interface RidgeState {
  /** 行優先の XᵀX（RIDGE_DIM × RIDGE_DIM） */
  xtx: number[]
  xty: number[]
  samples: number
}

export function emptyRidgeState(): RidgeState {
  return { xtx: new Array(RIDGE_DIM * RIDGE_DIM).fill(0), xty: new Array(RIDGE_DIM).fill(0), samples: 0 }
}

/**
 * 要因分解 [{key, pt}] と曜日から特徴ベクトルを作る
 */
export function buildFeatures(factors: Array<{ key: string; pt: number }>, dayOfWeek: number): number[] {
  const x = new Array<number>(RIDGE_DIM).fill(0)
  x[0] = 1
  for (const f of factors) {
    const g = factorGroup(f.key)
    if (!g) continue
    x[RIDGE_FEATURE_KEYS.indexOf(g)] += f.pt
  }
  x[RIDGE_FEATURE_KEYS.indexOf(`dow${dayOfWeek}` as RidgeFeatureKey)] = 1
  return x
}

export function addSample(state: RidgeState, x: number[], y: number): RidgeState {
  const xtx = [...state.xtx]
  const xty = [...state.xty]
  for (let i = 0; i < RIDGE_DIM; i++) {
    xty[i] += x[i] * y
    for (let j = 0; j < RIDGE_DIM; j++) xtx[i * RIDGE_DIM + j] += x[i] * x[j]
  }
  return { xtx, xty, samples: state.samples + 1 }
}

/** prior 重み: ルールベースと同じ（各要因 pt をそのまま足す = 1、bias/曜日 = 0） */
export function priorWeights(): number[] {
  const w = new Array<number>(RIDGE_DIM).fill(0)
  for (const g of ['base', 'pace', 'holiday', 'special', 'school', 'event', 'weather', 'weekend', 'comp'] as const) {
    w[RIDGE_FEATURE_KEYS.indexOf(g)] = 1
  }
  return w
}

/** ガウスの消去法で A w = b を解く（A は対称正定値を想定） */
function solve(a: number[], b: number[], n: number): number[] {
  const m = a.map((v) => v)
  const r = [...b]
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) if (Math.abs(m[row * n + col]) > Math.abs(m[pivot * n + col])) pivot = row
    if (Math.abs(m[pivot * n + col]) < 1e-12) continue
    if (pivot !== col) {
      for (let k = 0; k < n; k++) [m[col * n + k], m[pivot * n + k]] = [m[pivot * n + k], m[col * n + k]]
      ;[r[col], r[pivot]] = [r[pivot], r[col]]
    }
    for (let row = col + 1; row < n; row++) {
      const f = m[row * n + col] / m[col * n + col]
      if (f === 0) continue
      for (let k = col; k < n; k++) m[row * n + k] -= f * m[col * n + k]
      r[row] -= f * r[col]
    }
  }
  const w = new Array<number>(n).fill(0)
  for (let row = n - 1; row >= 0; row--) {
    let s = r[row]
    for (let k = row + 1; k < n; k++) s -= m[row * n + k] * w[k]
    const d = m[row * n + row]
    w[row] = Math.abs(d) < 1e-12 ? 0 : s / d
  }
  return w
}

/**
 * 重みを解く。prior への縮小: (XᵀX + λI) w = Xᵀy + λ w_prior
 * 特徴量は稼働率 pt（0.1 前後）なので λ は小さめ（既定 0.3 ≒ その要因が 0.1pt で 30 日分観測されたとき
 * prior と実績が半々）。サンプルが少ないほど prior が支配し、増えるほど実績に寄る
 */
export const DEFAULT_RIDGE_LAMBDA = 0.3

export function solveWeights(state: RidgeState, lambda = DEFAULT_RIDGE_LAMBDA): number[] {
  const prior = priorWeights()
  const a = [...state.xtx]
  const b = [...state.xty]
  for (let i = 0; i < RIDGE_DIM; i++) {
    a[i * RIDGE_DIM + i] += lambda
    b[i] += lambda * prior[i]
  }
  return solve(a, b, RIDGE_DIM)
}

export function predict(weights: number[], x: number[]): number {
  let s = 0
  for (let i = 0; i < RIDGE_DIM; i++) s += weights[i] * x[i]
  return s
}
