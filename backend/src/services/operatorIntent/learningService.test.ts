import { describe, it, expect } from 'vitest'
import {
  median,
  clampRankDelta,
  dominantIntentReasonOf,
  computePreferenceProfiles,
  evaluateOutperformed,
  MAX_RANK_DELTA,
  type DecisionSample,
} from './learningService.js'

function sample(overrides: Partial<DecisionSample> = {}): DecisionSample {
  return {
    segmentKey: 'A:weekend',
    demandLevel: 'A',
    dayType: 'weekend',
    rankDelta: 2,
    intentReason: 'EVENT_DEMAND',
    outperformed: null,
    ...overrides,
  }
}

describe('median', () => {
  it('奇数件は中央、偶数件は中央2件の平均を返す', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 6])).toBe(2.5)
  })

  it('空配列は 0（補正なし）', () => {
    expect(median([])).toBe(0)
  })
})

describe('clampRankDelta', () => {
  it('補正幅を ±MAX_RANK_DELTA に収める（誤った意向の増幅防止）', () => {
    expect(clampRankDelta(10)).toBe(MAX_RANK_DELTA)
    expect(clampRankDelta(-10)).toBe(-MAX_RANK_DELTA)
    expect(clampRankDelta(2)).toBe(2)
  })
})

describe('dominantIntentReasonOf', () => {
  it('最も多い意向理由を返す', () => {
    expect(
      dominantIntentReasonOf(['EVENT_DEMAND', 'COMPETITOR_MOVE', 'EVENT_DEMAND'])
    ).toBe('EVENT_DEMAND')
  })

  it('空なら null', () => {
    expect(dominantIntentReasonOf([])).toBeNull()
  })
})

describe('evaluateOutperformed', () => {
  it('実績RevPARが想定RevPARを許容誤差より上回れば true', () => {
    // 想定 = 予測稼働率 0.7 × 予測ADR 18,000 = 12,600
    expect(
      evaluateOutperformed({
        aiPredictedOccupancy: 0.7,
        aiPredictedAdr: 18_000,
        aiRecommendedPrice: 25_000,
        actualRevPar: 14_000,
      })
    ).toBe(true)
    expect(
      evaluateOutperformed({
        aiPredictedOccupancy: 0.7,
        aiPredictedAdr: 18_000,
        aiRecommendedPrice: 25_000,
        actualRevPar: 11_000,
      })
    ).toBe(false)
  })

  it('基準は推奨価格ではなく予測ADR（定価とブレンドADRを比較しない）', () => {
    // 推奨価格 25,000 を基準にすると想定 17,500 となり false になるケース
    expect(
      evaluateOutperformed({
        aiPredictedOccupancy: 0.7,
        aiPredictedAdr: 18_000,
        aiRecommendedPrice: 25_000,
        actualRevPar: 13_500,
      })
    ).toBe(true)
  })

  it('予測ADRが無い場合のみ推奨価格で代替する', () => {
    expect(
      evaluateOutperformed({
        aiPredictedOccupancy: 0.7,
        aiPredictedAdr: null,
        aiRecommendedPrice: 18_000,
        actualRevPar: 14_000,
      })
    ).toBe(true)
  })

  it('実績が無ければ評価対象外（null）', () => {
    expect(
      evaluateOutperformed({
        aiPredictedOccupancy: 0.7,
        aiPredictedAdr: 18_000,
        aiRecommendedPrice: 18_000,
        actualRevPar: null,
      })
    ).toBeNull()
  })
})

describe('computePreferenceProfiles', () => {
  it('セグメント別に中央値ベースの補正を算出する', () => {
    const samples = [
      sample({ rankDelta: 2, outperformed: true }),
      sample({ rankDelta: 3, outperformed: true }),
      sample({ rankDelta: 2, outperformed: true }),
      sample({ rankDelta: 2, outperformed: null }),
      sample({ rankDelta: 3, outperformed: null }),
    ]
    const [profile] = computePreferenceProfiles(samples)

    expect(profile.segmentKey).toBe('A:weekend')
    expect(profile.sampleCount).toBe(5)
    expect(profile.medianRankDelta).toBe(2)
    expect(profile.appliedRankDelta).toBe(2)
    expect(profile.outperformRate).toBe(1)
    expect(profile.evaluatedCount).toBe(3)
    expect(profile.dominantIntentReason).toBe('EVENT_DEMAND')
    expect(profile.suppressedReason).toBeNull()
  })

  it('件数が閾値未満のセグメントは補正を適用しない', () => {
    const [profile] = computePreferenceProfiles([sample({ rankDelta: 3 }), sample({ rankDelta: 3 })])
    expect(profile.sampleCount).toBe(2)
    expect(profile.medianRankDelta).toBe(3)
    expect(profile.appliedRankDelta).toBe(0)
    expect(profile.suppressedReason).toBe('INSUFFICIENT_SAMPLES')
  })

  it('意向どおりに動かしても実績が伴わないセグメントは補正を適用しない', () => {
    const samples = [
      sample({ rankDelta: 3, outperformed: false }),
      sample({ rankDelta: 3, outperformed: false }),
      sample({ rankDelta: 3, outperformed: false }),
      sample({ rankDelta: 3, outperformed: true }),
      sample({ rankDelta: 3, outperformed: null }),
    ]
    const [profile] = computePreferenceProfiles(samples)
    expect(profile.outperformRate).toBe(0.25)
    expect(profile.appliedRankDelta).toBe(0)
    expect(profile.suppressedReason).toBe('NOT_OUTPERFORMING')
  })

  it('外れ値1件で補正が引きずられない（平均ではなく中央値を使う）', () => {
    const samples = [
      sample({ rankDelta: 1 }),
      sample({ rankDelta: 1 }),
      sample({ rankDelta: 1 }),
      sample({ rankDelta: 1 }),
      sample({ rankDelta: 20 }),
    ]
    const [profile] = computePreferenceProfiles(samples)
    expect(profile.avgRankDelta).toBe(4.8)
    expect(profile.medianRankDelta).toBe(1)
    expect(profile.appliedRankDelta).toBe(1)
  })

  it('補正値は ±MAX_RANK_DELTA にクランプされる', () => {
    const samples = Array.from({ length: 6 }, () => sample({ rankDelta: 9, outperformed: true }))
    const [profile] = computePreferenceProfiles(samples)
    expect(profile.medianRankDelta).toBe(9)
    expect(profile.appliedRankDelta).toBe(MAX_RANK_DELTA)
  })

  it('セグメントが混在していても別々に集計する', () => {
    const profiles = computePreferenceProfiles([
      ...Array.from({ length: 5 }, () => sample({ rankDelta: 2 })),
      ...Array.from({ length: 5 }, () =>
        sample({ segmentKey: 'D:weekday', demandLevel: 'D', dayType: 'weekday', rankDelta: -2, intentReason: 'COMPETITOR_MOVE' })
      ),
    ])
    expect(profiles.map((p) => p.segmentKey)).toEqual(['A:weekend', 'D:weekday'])
    expect(profiles[0].appliedRankDelta).toBe(2)
    expect(profiles[1].appliedRankDelta).toBe(-2)
  })
})
