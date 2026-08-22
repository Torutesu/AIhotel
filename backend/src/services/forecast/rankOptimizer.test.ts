import { describe, it, expect } from 'vitest'
import {
  estimateOccupancyAtPrice,
  selectRecommendedRank,
  DEFAULT_STRATEGY_WEIGHTS,
} from './rankOptimizer.js'

// rank r の価格 = 10000 + r * 500 の単純な価格マスタ
function makePriceMap(maxRank = 40): Map<number, number> {
  const m = new Map<number, number>()
  for (let r = 1; r <= maxRank; r++) m.set(r, 10000 + r * 500)
  return m
}

describe('estimateOccupancyAtPrice', () => {
  it('値上げすると期待稼働率が下がり、値下げすると上がる（負の弾力性）', () => {
    const base = estimateOccupancyAtPrice(0.8, 20000, 20000)
    expect(base).toBeCloseTo(0.8, 5)
    expect(estimateOccupancyAtPrice(0.8, 20000, 22000)).toBeLessThan(0.8)
    expect(estimateOccupancyAtPrice(0.8, 20000, 18000)).toBeGreaterThan(0.8)
  })

  it('[0,1] にclampされる', () => {
    expect(estimateOccupancyAtPrice(0.99, 20000, 10000)).toBeLessThanOrEqual(1)
  })

  it('不正な価格では変化させない', () => {
    expect(estimateOccupancyAtPrice(0.8, 0, 20000)).toBe(0.8)
  })
})

describe('selectRecommendedRank', () => {
  const priceByRank = makePriceMap()

  it('ADR重視100%なら候補中の最高ランクを選ぶ', () => {
    const result = selectRecommendedRank({
      baselineRank: 20,
      predictedOccupancy: 0.7,
      priceByRank,
      weights: { weightOccupancy: 0, weightAdr: 100, weightCompetitor: 0 },
      competitorAvgPrice: null,
      maxRank: 40,
    })
    expect(result.rank).toBe(23) // baseline+3（探索幅の上限）
  })

  it('稼働率重視100%なら候補中の最低ランク（最安値）を選ぶ', () => {
    const result = selectRecommendedRank({
      baselineRank: 20,
      predictedOccupancy: 0.7,
      priceByRank,
      weights: { weightOccupancy: 100, weightAdr: 0, weightCompetitor: 0 },
      competitorAvgPrice: null,
      maxRank: 40,
    })
    expect(result.rank).toBe(17) // baseline-3
  })

  it('競合追従100%なら競合平均に最も近い価格のランクを選ぶ', () => {
    // rank 22 の価格 = 21000
    const result = selectRecommendedRank({
      baselineRank: 20,
      predictedOccupancy: 0.7,
      priceByRank,
      weights: { weightOccupancy: 0, weightAdr: 0, weightCompetitor: 100 },
      competitorAvgPrice: 21000,
      maxRank: 40,
    })
    expect(result.rank).toBe(22)
    expect(result.price).toBe(21000)
  })

  it('重みを変えると推奨ランクが動く（デッドコンフィグではない — P-2）', () => {
    const adrHeavy = selectRecommendedRank({
      baselineRank: 20,
      predictedOccupancy: 0.7,
      priceByRank,
      weights: { weightOccupancy: 10, weightAdr: 80, weightCompetitor: 10 },
      competitorAvgPrice: 20000,
      maxRank: 40,
    })
    const occHeavy = selectRecommendedRank({
      baselineRank: 20,
      predictedOccupancy: 0.7,
      priceByRank,
      weights: { weightOccupancy: 80, weightAdr: 10, weightCompetitor: 10 },
      competitorAvgPrice: 20000,
      maxRank: 40,
    })
    expect(adrHeavy.rank).toBeGreaterThan(occHeavy.rank)
  })

  it('競合データがない日は競合重みを除外して残りで正規化する', () => {
    const result = selectRecommendedRank({
      baselineRank: 20,
      predictedOccupancy: 0.7,
      priceByRank,
      weights: { weightOccupancy: 0, weightAdr: 50, weightCompetitor: 50 },
      competitorAvgPrice: null,
      maxRank: 40,
    })
    expect(result.rank).toBe(23) // 実質ADR 100% と同じ挙動
  })

  it('探索幅は maxRank を超えない', () => {
    const result = selectRecommendedRank({
      baselineRank: 39,
      predictedOccupancy: 0.95,
      priceByRank,
      weights: { weightOccupancy: 0, weightAdr: 100, weightCompetitor: 0 },
      competitorAvgPrice: null,
      maxRank: 40,
    })
    expect(result.rank).toBeLessThanOrEqual(40)
  })

  it('価格マスタが引けなければベースラインを維持する', () => {
    const result = selectRecommendedRank({
      baselineRank: 20,
      predictedOccupancy: 0.7,
      priceByRank: new Map(),
      weights: DEFAULT_STRATEGY_WEIGHTS,
      competitorAvgPrice: null,
      maxRank: 40,
    })
    expect(result).toEqual({ rank: 20, price: null })
  })
})
