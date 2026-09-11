// 継続学習の純粋ロジック（docs/外部要因設計.md §5.2 L1）。DB 非依存。
//
// 実績が確定した宿泊日について、基準日ごとのスナップショット（予測）と実績の残差を
// その日に効いていた要因キーへ均等に配分し、指数平滑で係数を更新する（縮小推定:
// サンプル数が少ないうちは初期値寄り、増えるほど実績寄り）。
// 併せてリードタイム区分別の MAPE を更新し、信頼区間の校正に使う。
import { FACTOR_DEFAULTS, leadBucket } from './factorDefaults.js'

export interface LearningSample {
  stayDate: string
  leadDays: number
  predictedOccupancy: number
  actualOccupancy: number
  /** その日に効いていた係数キー（base/pace を除く） */
  activeFactorKeys: string[]
}

export interface CoefficientState {
  value: number
  sampleSize: number
  /** 個社MDで固定された係数。学習で動かさない */
  locked?: boolean
}

export interface LearningResult {
  coefficients: Map<string, CoefficientState>
  /** 更新のあったキーと前後の値 */
  updates: Array<{ key: string; before: number; after: number; sampleSize: number }>
  calibration: Array<{ bucket: string; before: number; after: number; samples: number }>
  samples: number
}

const COEFFICIENT_MIN = -0.3
const COEFFICIENT_MAX = 0.3
const CALIBRATION_LAMBDA = 0.1
const MIN_LEARNING_RATE = 0.05
const BASE_LEARNING_RATE = 0.3

/** 縮小推定の学習率: サンプルが増えるほど小さくする */
export function learningRate(sampleSize: number): number {
  return Math.max(MIN_LEARNING_RATE, BASE_LEARNING_RATE / (1 + sampleSize / 10))
}

/**
 * 残差を要因に配分して係数を更新する。calibration はリードタイム区分別 MAPE。
 * @param current 既存の学習状態（無いキーは初期値 sampleSize=0 から始める）
 */
export function applyLearning(samples: LearningSample[], current: ReadonlyMap<string, CoefficientState>): LearningResult {
  const coefficients = new Map<string, CoefficientState>()
  for (const [k, v] of current) coefficients.set(k, { ...v })

  const get = (key: string): CoefficientState =>
    coefficients.get(key) ?? { value: FACTOR_DEFAULTS[key] ?? 0, sampleSize: 0 }

  const touched = new Map<string, number>()
  const calibTouched = new Map<string, { before: number; samples: number }>()

  for (const s of samples) {
    const residual = s.actualOccupancy - s.predictedOccupancy // pt（+ = 予測が低すぎた）

    // ---- 要因係数（最も直近のリードタイム 1〜14 日のサンプルだけを使う。遠い予測は base の誤差が支配的）
    if (s.leadDays >= 1 && s.leadDays <= 14 && s.activeFactorKeys.length > 0) {
      const share = residual / s.activeFactorKeys.length
      for (const key of s.activeFactorKeys) {
        const state = get(key)
        if (state.locked) continue
        if (!touched.has(key)) touched.set(key, state.value)
        const eta = learningRate(state.sampleSize)
        const next = Math.min(COEFFICIENT_MAX, Math.max(COEFFICIENT_MIN, state.value + eta * share))
        coefficients.set(key, { value: next, sampleSize: state.sampleSize + 1 })
      }
    }

    // ---- 信頼度校正（全リードタイム）
    const bucket = leadBucket(s.leadDays)
    const calibKey = `calib:${bucket}`
    const state = get(calibKey)
    if (!calibTouched.has(calibKey)) calibTouched.set(calibKey, { before: state.value, samples: 0 })
    const ape = Math.abs(residual) / Math.max(s.actualOccupancy, 0.2)
    const next = state.sampleSize === 0 ? (state.value + ape) / 2 : (1 - CALIBRATION_LAMBDA) * state.value + CALIBRATION_LAMBDA * ape
    coefficients.set(calibKey, { value: next, sampleSize: state.sampleSize + 1 })
    calibTouched.get(calibKey)!.samples++
  }

  const updates = [...touched].map(([key, before]) => ({
    key,
    before,
    after: coefficients.get(key)!.value,
    sampleSize: coefficients.get(key)!.sampleSize,
  }))
  const calibration = [...calibTouched].map(([key, v]) => ({
    bucket: key.replace('calib:', ''),
    before: v.before,
    after: coefficients.get(key)!.value,
    samples: v.samples,
  }))

  return { coefficients, updates, calibration, samples: samples.length }
}

export interface AccuracySummary {
  bucket: string
  samples: number
  mape: number
  /** 平均残差（+ = 予測が低すぎる傾向） */
  bias: number
  /** 要因なし（base のみ）の MAPE。要因が精度に寄与したかの比較用 */
  baselineMape: number | null
}

/**
 * バックテスト/精度レポート用の集計（リードタイム区分別）
 */
export function summarizeAccuracy(
  samples: Array<LearningSample & { baseOccupancy?: number }>
): AccuracySummary[] {
  const groups = new Map<string, Array<LearningSample & { baseOccupancy?: number }>>()
  for (const s of samples) {
    const b = leadBucket(s.leadDays)
    const list = groups.get(b) ?? []
    list.push(s)
    groups.set(b, list)
  }
  const order = ['lead0_3', 'lead4_7', 'lead8_30', 'lead31_90', 'lead91']
  return order
    .filter((b) => groups.has(b))
    .map((bucket) => {
      const list = groups.get(bucket)!
      const ape = list.map((s) => Math.abs(s.actualOccupancy - s.predictedOccupancy) / Math.max(s.actualOccupancy, 0.2))
      const bias = list.reduce((sum, s) => sum + (s.actualOccupancy - s.predictedOccupancy), 0) / list.length
      const withBase = list.filter((s) => s.baseOccupancy != null)
      const baselineMape =
        withBase.length > 0
          ? withBase.reduce((sum, s) => sum + Math.abs(s.actualOccupancy - s.baseOccupancy!) / Math.max(s.actualOccupancy, 0.2), 0) / withBase.length
          : null
      return {
        bucket,
        samples: list.length,
        mape: ape.reduce((a, b) => a + b, 0) / ape.length,
        bias,
        baselineMape,
      }
    })
}
