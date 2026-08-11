import { describe, it, expect } from 'vitest'
import {
  summarizeAccuracy,
  horizonBucketOf,
  meanAbsoluteError,
  TARGET_ERROR_PT,
  type ScoredPrediction,
} from './evaluation.js'

// 予測精度の測定（4E-1 — docs/ai-agent-design.md §9）
// 仕様の「エラー率±10%以内」は予測時点別に測らないと意味を持たない

const prediction = (
  leadTimeDays: number,
  predicted: number,
  actual: number,
  modelVersion = 'test-v1'
): ScoredPrediction => ({
  leadTimeDays,
  predictedOccupancy: predicted,
  actualOccupancy: actual,
  modelVersion,
})

describe('horizonBucketOf', () => {
  it('予測時点をバケットに割り当てる', () => {
    expect(horizonBucketOf(0)).toBe('0-7')
    expect(horizonBucketOf(7)).toBe('0-7')
    expect(horizonBucketOf(8)).toBe('8-30')
    expect(horizonBucketOf(90)).toBe('31-90')
    expect(horizonBucketOf(180)).toBe('91-180')
  })

  it('180日を超える予測も捨てずに最遠バケットへ入れる', () => {
    expect(horizonBucketOf(365)).toBe('91-180')
  })

  it('宿泊日より後に計算したもの（負のリードタイム）はバケットに入れない', () => {
    // 予測ではなく後付けの計算。最短バケットに混ぜると7日前予測の精度が歪む
    expect(horizonBucketOf(-1)).toBeNull()
  })
})

describe('summarizeAccuracy', () => {
  it('予測時点ごとに誤差を分けて集計する', () => {
    const result = summarizeAccuracy([
      prediction(3, 0.8, 0.78),
      prediction(5, 0.7, 0.72),
      prediction(60, 0.6, 0.4),
    ])

    const near = result.buckets.find((b) => b.key === '0-7')!
    const far = result.buckets.find((b) => b.key === '31-90')!
    expect(near.sampleCount).toBe(2)
    expect(near.mae).toBeCloseTo(0.02, 4)
    expect(far.sampleCount).toBe(1)
    expect(far.mae).toBeCloseTo(0.2, 4)
  })

  it('±10pt以内に収まった割合を出す（仕様の精度目標に対応）', () => {
    const result = summarizeAccuracy([
      prediction(3, 0.8, 0.75), // 5pt → 達成
      prediction(3, 0.8, 0.6), // 20pt → 未達
    ])
    expect(result.buckets.find((b) => b.key === '0-7')!.withinTargetRatio).toBe(0.5)
    expect(TARGET_ERROR_PT).toBe(0.1)
  })

  it('符号つきの平均誤差で「高く出す癖／低く出す癖」が分かる', () => {
    const high = summarizeAccuracy([prediction(3, 0.8, 0.7), prediction(4, 0.9, 0.8)])
    expect(high.buckets.find((b) => b.key === '0-7')!.bias).toBeCloseTo(0.1, 4)

    const low = summarizeAccuracy([prediction(3, 0.6, 0.7)])
    expect(low.buckets.find((b) => b.key === '0-7')!.bias).toBeCloseTo(-0.1, 4)
  })

  it('RMSEがMAEより大きければ大外しが混ざっていると分かる', () => {
    const result = summarizeAccuracy([
      prediction(3, 0.7, 0.7),
      prediction(3, 0.7, 0.7),
      prediction(3, 0.7, 0.1), // 1件だけ大外し
    ])
    const bucket = result.buckets.find((b) => b.key === '0-7')!
    expect(bucket.rmse).toBeGreaterThan(bucket.mae)
  })

  it('サンプルが無ければ達成判定をしない（0件を「達成」と誤報しない）', () => {
    const result = summarizeAccuracy([])
    expect(result.totalSamples).toBe(0)
    expect(result.meetsTarget).toBeNull()
    expect(result.buckets).toHaveLength(4)
  })

  it('全体MAEが目標以内なら達成と判定する', () => {
    expect(summarizeAccuracy([prediction(3, 0.75, 0.7)]).meetsTarget).toBe(true)
    expect(summarizeAccuracy([prediction(3, 0.9, 0.5)]).meetsTarget).toBe(false)
  })

  it('宿泊日より後に計算されたものは測定から除外し、件数だけ報告する', () => {
    const result = summarizeAccuracy([
      prediction(3, 0.75, 0.7),
      prediction(-10, 0.2, 0.9), // 後付けの計算。混ぜると精度が実力と乖離する
    ])
    expect(result.totalSamples).toBe(1)
    expect(result.excludedHindcasts).toBe(1)
    expect(result.overallMae).toBeCloseTo(0.05, 4)
    expect(result.buckets.find((b) => b.key === '0-7')!.sampleCount).toBe(1)
  })

  it('複数モデルの予測が混ざっていればバージョンを列挙する', () => {
    const result = summarizeAccuracy([
      prediction(3, 0.7, 0.7, 'ridge-v1'),
      prediction(3, 0.7, 0.7, 'gbm-v1'),
    ])
    expect(result.modelVersions).toEqual(['gbm-v1', 'ridge-v1'])
  })
})

describe('meanAbsoluteError', () => {
  it('モデル選択用に1つの数字を返す', () => {
    expect(meanAbsoluteError([0.5, 0.7], [0.4, 0.9])).toBeCloseTo(0.15, 6)
  })

  it('空なら無限大を返す（候補として選ばれないように）', () => {
    expect(meanAbsoluteError([], [])).toBe(Number.POSITIVE_INFINITY)
  })

  it('件数が食い違えば例外にする（黙って間違った誤差を返さない）', () => {
    expect(() => meanAbsoluteError([0.5], [0.4, 0.3])).toThrow(/一致しません/)
  })
})
