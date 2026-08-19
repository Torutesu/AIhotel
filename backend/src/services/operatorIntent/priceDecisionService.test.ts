import { describe, it, expect } from 'vitest'
import { deriveDecisionType } from './priceDecisionService.js'

describe('deriveDecisionType', () => {
  it('AI推奨と同じランクなら ACCEPTED', () => {
    expect(deriveDecisionType({ aiRecommendedRank: 20, appliedRank: 20 })).toBe('ACCEPTED')
  })

  it('AI推奨より高い／低いランクを RAISED / LOWERED として導出する', () => {
    expect(deriveDecisionType({ aiRecommendedRank: 20, appliedRank: 23 })).toBe('RAISED')
    expect(deriveDecisionType({ aiRecommendedRank: 20, appliedRank: 17 })).toBe('LOWERED')
  })

  it('ランクが揃っていなければ価格で比較する', () => {
    expect(
      deriveDecisionType({ aiRecommendedPrice: 18_000, appliedPrice: 19_800 })
    ).toBe('RAISED')
    expect(
      deriveDecisionType({ aiRecommendedRank: 20, aiRecommendedPrice: 18_000, appliedPrice: 16_000 })
    ).toBe('LOWERED')
  })

  it('比較材料が無ければ ACCEPTED（差異なしとして扱う）', () => {
    expect(deriveDecisionType({})).toBe('ACCEPTED')
    expect(deriveDecisionType({ aiRecommendedRank: null, appliedRank: 20 })).toBe('ACCEPTED')
  })
})
