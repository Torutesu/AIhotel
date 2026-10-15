// 推奨理由（#24 E4）。「なぜこのランクを推奨したか」を返す JSON で、
// モデルが変わっても形を変えない外部契約 v1 として固定する。
// 新しい要因を足すときは factors / adjustments の key を増やすだけにし、既存のキーの意味を変えない。

import type { GuardrailKey } from './strategyWeighting.js'

export const RATIONALE_VERSION = 1

export type RationaleFactorKey = 'occupancy' | 'adr' | 'competitor'

export interface RationaleFactor {
  key: RationaleFactorKey
  /** その観点だけで決めた場合のランク */
  rank: number
  /** 実際に効いた重み（%。データが無い観点を除いて按分した後） */
  weight: number
  /** その観点の入力値（観点ごとに中身が違う） */
  input: Record<string, number | string | null>
}

export interface RationaleV1 {
  version: typeof RATIONALE_VERSION
  modelVersion: string
  recommendedRank: number
  factors: RationaleFactor[]
  /**
   * 予測稼働率への補正（稼働率観点の内訳）。
   * pace = 前年同曜日と比べた予約の入り方（D-11）、otbFloor = 予約済みの室数を下限にした引き上げ（D-11）。
   * input はその補正の材料（キーごとに中身が違う。無いこともある）
   */
  adjustments: Array<{
    key: 'event' | 'weekend' | 'pace' | 'otbFloor'
    impact: number
    input?: Record<string, number | string | null>
  }>
  /** 合成から外した観点と理由。no_data = データ無し、stale = 古い、zero_weight = 重み0 */
  excluded: Array<{ key: RationaleFactorKey; reason: 'no_data' | 'stale' | 'zero_weight' }>
  /** かかったガードレール（#17）。from → to の順にかかった */
  guardrails: Array<{ key: GuardrailKey; from: number; to: number }>
}
