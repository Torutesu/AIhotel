import { describe, it, expect } from 'vitest'
import { decideRank, mapOccupancyToBaseRank, type RankDecisionInput } from './rankDecision.js'

// seed と同じ 40 段階（6,500〜30,000 円）
const ranks = Array.from({ length: 40 }, (_, i) => ({ rank: i + 1, price1P: Math.round(6500 + (i / 39) * 23500) }))

function input(overrides: Partial<RankDecisionInput> = {}): RankDecisionInput {
  return {
    predictedOccupancy: 0.75,
    unconstrainedOccupancy: 0.75,
    ranks,
    weights: { weightOccupancy: 40, weightAdr: 40, weightCompetitor: 20 },
    guardrails: { minRank: 1, maxRank: 40, maxDailyRankChange: 5, competitorPositionPct: 0 },
    competitorMedianPrice: null,
    currentRank: null,
    previousRecommendedRank: null,
    sigma: 0.35,
    occupancyRevParTolerance: 0.05,
    adrRevParTolerance: 0.02,
    ...overrides,
  }
}

describe('mapOccupancyToBaseRank', () => {
  it('rule-based-v1 と同じ線形写像で 1〜maxRank に収める', () => {
    expect(mapOccupancyToBaseRank(0.75, 40)).toBe(30)
    expect(mapOccupancyToBaseRank(0, 40)).toBe(1)
    expect(mapOccupancyToBaseRank(1.5, 40)).toBe(40)
  })
})

describe('decideRank — 候補と重み', () => {
  it('稼働率重視候補は基準以下、ADR重視候補は基準以上になる', () => {
    const r = decideRank(input())
    expect(r.baseRank).toBe(30)
    expect(r.candidates.occupancy).toBeLessThan(r.baseRank)
    expect(r.candidates.adr).toBeGreaterThan(r.baseRank)
    expect(r.candidates.competitor).toBeNull()
  })

  it('稼働率重視の重みを上げると最終ランクが下がり、ADR重視の重みを上げると上がる', () => {
    const occHeavy = decideRank(input({ weights: { weightOccupancy: 80, weightAdr: 10, weightCompetitor: 10 } }))
    const adrHeavy = decideRank(input({ weights: { weightOccupancy: 10, weightAdr: 80, weightCompetitor: 10 } }))
    expect(occHeavy.rank).toBeLessThan(adrHeavy.rank)
  })

  it('競合データが無ければ競合追従は中立（基準ランク）で、寄与は 0', () => {
    const r = decideRank(input({ weights: { weightOccupancy: 0, weightAdr: 0, weightCompetitor: 100 } }))
    expect(r.rank).toBe(r.baseRank)
    expect(r.contributions.find((c) => c.key === 'competitor')?.delta).toBe(0)
  })

  it('競合中央値とポジション設定に最も近いランクへ引き寄せる', () => {
    const r = decideRank(
      input({
        weights: { weightOccupancy: 0, weightAdr: 0, weightCompetitor: 100 },
        competitorMedianPrice: 18000,
        guardrails: { minRank: 1, maxRank: 40, maxDailyRankChange: null, competitorPositionPct: 10 },
      })
    )
    // 18,000 × 1.1 = 19,800 に最も近いランク
    const target = ranks.reduce((b, x) => (Math.abs(x.price1P - 19800) < Math.abs(b.price1P - 19800) ? x : b))
    expect(r.candidates.competitor).toBe(target.rank)
    expect(r.rank).toBe(target.rank)
  })
})

describe('decideRank — ガードレール', () => {
  it('適用中ランクから maxDailyRankChange を超えて動かさず、その分をガードレール寄与として出す', () => {
    const r = decideRank(input({ predictedOccupancy: 0.95, unconstrainedOccupancy: 0.95, currentRank: 20 }))
    expect(r.rank).toBe(25)
    const guard = r.contributions.find((c) => c.key === 'guardrail')
    expect(guard?.delta).toBeLessThan(0)
    expect(guard?.detail).toContain('±5')
  })

  it('minRank / maxRank の範囲に収める', () => {
    const r = decideRank(
      input({
        predictedOccupancy: 0.2,
        unconstrainedOccupancy: 0.2,
        guardrails: { minRank: 12, maxRank: 30, maxDailyRankChange: null, competitorPositionPct: 0 },
      })
    )
    expect(r.rank).toBe(12)
  })

  it('理由分解の合計が最終ランクに一致する', () => {
    for (const D of [0.3, 0.6, 0.85, 1]) {
      const r = decideRank(input({ predictedOccupancy: D, unconstrainedOccupancy: D, competitorMedianPrice: 17000, currentRank: 25 }))
      const sum = r.contributions.reduce((s, c) => s + (c.rank ?? 0) + (c.delta ?? 0), 0)
      expect(sum).toBeCloseTo(r.rank, 6)
    }
  })
})

describe('decideRank — 期待RevPAR', () => {
  it('比較対象は適用中ランクで、推奨が適用中と同じなら期待RevPARは等しい', () => {
    const r = decideRank(input({ currentRank: 30, weights: { weightOccupancy: 0, weightAdr: 100, weightCompetitor: 0 }, adrRevParTolerance: 0 }))
    expect(r.comparisonRank).toBe(30)
    expect(r.rank).toBe(30)
    expect(r.expectedRevParRecommended).toBe(r.expectedRevParCurrent)
  })

  it('適用中ランクが基準から大きく外れていれば、推奨への変更で期待RevPARが増える', () => {
    const r = decideRank(input({ currentRank: 15 }))
    expect(r.rank).toBeGreaterThan(15)
    expect(r.expectedRevParRecommended).toBeGreaterThan(r.expectedRevParCurrent)
  })
})
