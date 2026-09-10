import { describe, it, expect } from 'vitest'
import { summarizeAblation, summarizeFactorScorecard, summarizeRecommendationEffect, type EvaluationSample } from './evaluation.js'

function sample(over: Partial<EvaluationSample>): EvaluationSample {
  return {
    stayDate: '2026-09-18',
    leadDays: 3,
    predictedOccupancy: 0.8,
    unconstrainedOccupancy: 0.8,
    actualOccupancy: 0.8,
    demandFactors: [
      { key: 'base', label: '基準', pt: 0.7 },
      { key: 'holiday:eve', label: '連休前夜', pt: 0.1 },
    ],
    ...over,
  }
}

describe('summarizeAblation', () => {
  it('要因を外すと精度が悪化する場合、貢献が正になる', () => {
    const rows = summarizeAblation([sample({ actualOccupancy: 0.8 }), sample({ stayDate: '2026-09-19', actualOccupancy: 0.82 })])
    const holiday = rows.find((r) => r.group === 'holiday')!
    expect(holiday.activeDays).toBe(2)
    expect(holiday.mapeWithout).toBeGreaterThan(holiday.mapeWith)
    expect(holiday.contribution).toBeGreaterThan(0)
    // 効いていない要因は変化なし
    expect(rows.find((r) => r.group === 'weather')!.contribution).toBe(0)
  })

  it('要因が過大なら外した方が良くなり、貢献が負になる', () => {
    const rows = summarizeAblation([sample({ actualOccupancy: 0.7 })])
    expect(rows.find((r) => r.group === 'holiday')!.contribution).toBeLessThan(0)
  })
})

describe('summarizeFactorScorecard', () => {
  it('残差の平均が +3pt を超えれば過小評価、5件未満はデータ不足', () => {
    const few = summarizeFactorScorecard([sample({ actualOccupancy: 0.9 })], new Map([['holiday:eve', 0.1]]))
    expect(few[0].verdict).toBe('データ不足')
    const many = summarizeFactorScorecard(
      Array.from({ length: 6 }, (_, i) => sample({ stayDate: `2026-09-${10 + i}`, actualOccupancy: 0.88 })),
      new Map([['holiday:eve', 0.1]])
    )
    const eve = many.find((r) => r.key === 'holiday:eve')!
    expect(eve.samples).toBe(6)
    expect(eve.assumedPt).toBe(0.1)
    expect(eve.meanResidualPt).toBeCloseTo(0.08, 6)
    expect(eve.verdict).toBe('過小評価')
    expect(eve.positiveShare).toBe(1)
  })

  it('リードタイム 15 日以上は成績表に使わない', () => {
    expect(summarizeFactorScorecard([sample({ leadDays: 30 })], new Map())).toHaveLength(0)
  })
})

describe('summarizeRecommendationEffect', () => {
  it('需要レベル帯ごとに採用／上書き／未判断を分けて平均し、差を出す', () => {
    const { rows, overall } = summarizeRecommendationEffect([
      { stayDate: 'a', demandLevel: 'B', outcome: 'adopted', revPar: 20000, occupancy: 0.9, adr: 22000 },
      { stayDate: 'b', demandLevel: 'B', outcome: 'adopted', revPar: 21000, occupancy: 0.92, adr: 22500 },
      { stayDate: 'c', demandLevel: 'B', outcome: 'overridden', revPar: 18000, occupancy: 0.95, adr: 19000 },
      { stayDate: 'd', demandLevel: 'D', outcome: 'none', revPar: 9000, occupancy: 0.6, adr: 15000 },
    ])
    expect(rows.map((r) => r.demandLevel)).toEqual(['B', 'D'])
    const b = rows[0]
    expect(b.adopted.days).toBe(2)
    expect(b.adopted.avgRevPar).toBe(20500)
    expect(b.revParDiffAdoptedVsOverridden).toBe(2500)
    expect(rows[1].revParDiffAdoptedVsOverridden).toBeNull()
    expect(overall.none.days).toBe(1)
  })
})
