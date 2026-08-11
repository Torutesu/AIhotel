// ======================================
// 学習モデルの共通インターフェース（4E-2 — docs/ai-agent-design.md §2）
//
// Ridge と GBM を同じ形にそろえ、毎日の学習で検証誤差の小さい方を
// 自動採用できるようにする。どちらが勝つかはデータ次第で事前には決められないため、
// 議論ではなく実測で決める。
// ======================================

import type { TrainingSample } from '../features.js'

export type ModelAlgorithm = 'ridge' | 'gbm'

/** 学習済みモデル。DBに保存して再利用できるようJSON化可能な形だけを持つ */
export interface TrainedModel {
  algorithm: ModelAlgorithm
  /** 学習に使ったサンプル数 */
  sampleCount: number
  /** 検証データでのMAE。モデル選択の基準 */
  validationMae: number
  /** 特徴量の寄与度（0〜1に正規化）。MLOps画面と学習エージェントが読む */
  featureImportance: number[]
  /** アルゴリズム固有のパラメータ。predictWithModel が解釈する */
  params: unknown
}

export interface Trainer {
  algorithm: ModelAlgorithm
  /**
   * 学習する。検証データは呼び出し側が時系列で分けて渡す。
   * サンプルが足りない等で学習できない場合は null を返す（例外にしない）。
   */
  train(train: TrainingSample[], validation: TrainingSample[]): TrainedModel | null
  predict(model: TrainedModel, features: number[]): number
}
