// ======================================
// 予測精度の測定（4E-1 — docs/ai-agent-design.md §9）
//
// 仕様書の精度目標は「需要予測エラー率±10%以内」だが、
// 予測は7日前と90日前で難易度が全く違うため、ひとつの数字では意味を持たない。
// ここでは**予測時点別**に誤差を出す。
//
// 目標だけあって測れない状態を避けるため、モデル本体より先にこれを作る。
// ======================================

/** 予測時点の区分。仕様の測定単位に合わせる */
export const HORIZON_BUCKETS = [
  { key: '0-7', label: '7日前まで', maxDays: 7 },
  { key: '8-30', label: '8〜30日前', maxDays: 30 },
  { key: '31-90', label: '31〜90日前', maxDays: 90 },
  { key: '91-180', label: '91〜180日前', maxDays: 180 },
] as const

export type HorizonKey = (typeof HORIZON_BUCKETS)[number]['key']

/**
 * リードタイムからバケットを決める。
 *
 * 負のリードタイム（宿泊日より後に計算したもの）は**予測ではない**ので null を返す。
 * これを最短バケットに入れると「7日前予測」の精度が実力より良く/悪く見えてしまう。
 */
export function horizonBucketOf(leadTimeDays: number): HorizonKey | null {
  if (leadTimeDays < 0) return null
  for (const bucket of HORIZON_BUCKETS) {
    if (leadTimeDays <= bucket.maxDays) return bucket.key
  }
  // 180日を超える予測は仕様範囲外だが、捨てずに最遠のバケットへ入れる
  return HORIZON_BUCKETS[HORIZON_BUCKETS.length - 1].key
}

export interface ScoredPrediction {
  leadTimeDays: number
  predictedOccupancy: number
  actualOccupancy: number
  modelVersion: string
}

export interface AccuracyBucket {
  key: HorizonKey
  label: string
  sampleCount: number
  /** 平均絶対誤差（稼働率のpt。0.05 = 5pt） */
  mae: number
  /** 二乗平均平方根誤差。大外しの有無を見る（MAEとの差が大きいほど外れ値がある） */
  rmse: number
  /** 誤差±10pt以内に収まった割合。仕様の「エラー率±10%以内」に対応 */
  withinTargetRatio: number
  /** 平均誤差（符号つき）。プラスなら予測が高すぎる傾向 */
  bias: number
}

export interface AccuracySummary {
  modelVersions: string[]
  totalSamples: number
  /** 宿泊日より後に計算されたため精度測定から除外した件数（予測ではないもの） */
  excludedHindcasts: number
  buckets: AccuracyBucket[]
  /** 全体のMAE（バケット横断） */
  overallMae: number
  /** 仕様の精度目標（±10pt以内）を満たしているか。サンプルが無い場合は null */
  meetsTarget: boolean | null
}

/** 仕様書の「需要予測エラー率 ±10%以内」を稼働率のptとして解釈した閾値 */
export const TARGET_ERROR_PT = 0.1

/**
 * 予測と実績の組から精度サマリを作る。純関数（テスト対象）。
 *
 * 実績が未確定（宿泊日が未到来）のものは呼び出し側で除外しておくこと。
 */
export function summarizeAccuracy(input: ScoredPrediction[]): AccuracySummary {
  // 宿泊日より後に計算されたものは予測ではないので、測定対象から外す
  const predictions = input.filter((p) => p.leadTimeDays >= 0)
  const excludedHindcasts = input.length - predictions.length

  const byBucket = new Map<HorizonKey, ScoredPrediction[]>()
  for (const p of predictions) {
    const key = horizonBucketOf(p.leadTimeDays)
    if (key == null) continue
    const list = byBucket.get(key)
    if (list) list.push(p)
    else byBucket.set(key, [p])
  }

  const buckets: AccuracyBucket[] = HORIZON_BUCKETS.map((definition) => {
    const items = byBucket.get(definition.key) ?? []
    if (items.length === 0) {
      return {
        key: definition.key,
        label: definition.label,
        sampleCount: 0,
        mae: 0,
        rmse: 0,
        withinTargetRatio: 0,
        bias: 0,
      }
    }

    let absSum = 0
    let squareSum = 0
    let signedSum = 0
    let within = 0
    for (const item of items) {
      const error = item.predictedOccupancy - item.actualOccupancy
      absSum += Math.abs(error)
      squareSum += error * error
      signedSum += error
      if (Math.abs(error) <= TARGET_ERROR_PT) within += 1
    }

    return {
      key: definition.key,
      label: definition.label,
      sampleCount: items.length,
      mae: round4(absSum / items.length),
      rmse: round4(Math.sqrt(squareSum / items.length)),
      withinTargetRatio: round4(within / items.length),
      bias: round4(signedSum / items.length),
    }
  })

  const totalSamples = predictions.length
  const overallMae =
    totalSamples === 0
      ? 0
      : round4(
          predictions.reduce((sum, p) => sum + Math.abs(p.predictedOccupancy - p.actualOccupancy), 0) /
            totalSamples
        )

  return {
    modelVersions: [...new Set(predictions.map((p) => p.modelVersion))].sort(),
    totalSamples,
    excludedHindcasts,
    buckets,
    overallMae,
    meetsTarget: totalSamples === 0 ? null : overallMae <= TARGET_ERROR_PT,
  }
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

/**
 * 学習時のモデル選択に使う検証誤差（MAE）。
 * summarizeAccuracy と違い、予測時点で分けずに1つの数字を返す。
 */
export function meanAbsoluteError(predicted: number[], actual: number[]): number {
  if (predicted.length !== actual.length) {
    throw new Error('予測と実績の件数が一致しません')
  }
  if (predicted.length === 0) return Number.POSITIVE_INFINITY
  let sum = 0
  for (let i = 0; i < predicted.length; i += 1) {
    sum += Math.abs(predicted[i] - actual[i])
  }
  return sum / predicted.length
}
