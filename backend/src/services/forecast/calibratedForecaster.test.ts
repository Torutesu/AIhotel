import { describe, it, expect } from 'vitest'
import { applyOperatorCalibration } from './calibratedForecaster.js'
import type { DailyForecast } from './types.js'

const priceByRank = new Map<number, number>(
  Array.from({ length: 40 }, (_, i) => [i + 1, 8_000 + i * 500])
)

function forecast(overrides: Partial<DailyForecast> = {}): DailyForecast {
  return {
    date: new Date(Date.UTC(2026, 7, 1)),
    predictedOccupancy: 0.75,
    demandLevel: 'C',
    recommendedRank: 30,
    recommendedPrice: priceByRank.get(30) ?? null,
    confidence: 0.85,
    modelVersion: 'rule-based-v1',
    ...overrides,
  }
}

describe('applyOperatorCalibration', () => {
  it('補正値の分だけランクを動かし、価格を料金ランクマスタから引き直す', () => {
    const result = applyOperatorCalibration(forecast(), 2, 40, priceByRank)
    expect(result.recommendedRank).toBe(32)
    expect(result.recommendedPrice).toBe(priceByRank.get(32))
    expect(result.operatorRankDelta).toBe(2)
    expect(result.modelVersion).toBe('rule-based-v1+operator-calibration-v1')
  })

  it('補正が0なら予測をそのまま返す（モデル名も変えない）', () => {
    const result = applyOperatorCalibration(forecast(), 0, 40, priceByRank)
    expect(result.recommendedRank).toBe(30)
    expect(result.modelVersion).toBe('rule-based-v1')
    expect(result.operatorRankDelta).toBe(0)
  })

  it('補正後のランクは 1〜maxRank にクランプされ、実際に適用できた差分を返す', () => {
    const upper = applyOperatorCalibration(forecast({ recommendedRank: 39 }), 3, 40, priceByRank)
    expect(upper.recommendedRank).toBe(40)
    expect(upper.operatorRankDelta).toBe(1)

    const lower = applyOperatorCalibration(forecast({ recommendedRank: 2 }), -3, 40, priceByRank)
    expect(lower.recommendedRank).toBe(1)
    expect(lower.operatorRankDelta).toBe(-1)
  })

  it('推奨ランクが無い日は補正しない', () => {
    const result = applyOperatorCalibration(
      forecast({ recommendedRank: null, recommendedPrice: null }),
      2,
      40,
      priceByRank
    )
    expect(result.recommendedRank).toBeNull()
    expect(result.operatorRankDelta).toBe(0)
  })
})
