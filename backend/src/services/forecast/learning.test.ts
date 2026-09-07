import { describe, it, expect } from 'vitest'
import { applyLearning, learningRate, summarizeAccuracy, type LearningSample } from './learning.js'
import { FACTOR_DEFAULTS } from './factorDefaults.js'

describe('learningRate', () => {
  it('サンプルが増えるほど小さくなり、下限で止まる', () => {
    expect(learningRate(0)).toBeCloseTo(0.3, 6)
    expect(learningRate(10)).toBeCloseTo(0.15, 6)
    expect(learningRate(1000)).toBe(0.05)
  })
})

describe('applyLearning', () => {
  it('予測が低すぎた日の要因係数を上げ、高すぎた日の係数を下げる', () => {
    const samples: LearningSample[] = [
      { stayDate: '2026-09-18', leadDays: 3, predictedOccupancy: 0.8, actualOccupancy: 0.95, activeFactorKeys: ['holiday:eve'] },
    ]
    const r = applyLearning(samples, new Map())
    const eve = r.coefficients.get('holiday:eve')!
    expect(eve.value).toBeCloseTo(FACTOR_DEFAULTS['holiday:eve'] + 0.3 * 0.15, 6)
    expect(eve.sampleSize).toBe(1)
    expect(r.updates[0].key).toBe('holiday:eve')

    const r2 = applyLearning(
      [{ stayDate: '2026-09-19', leadDays: 3, predictedOccupancy: 0.95, actualOccupancy: 0.8, activeFactorKeys: ['holiday:eve'] }],
      r.coefficients
    )
    expect(r2.coefficients.get('holiday:eve')!.value).toBeLessThan(eve.value)
    expect(r2.coefficients.get('holiday:eve')!.sampleSize).toBe(2)
  })

  it('複数要因が効いた日は残差を均等に配分する', () => {
    const r = applyLearning(
      [{ stayDate: '2026-08-13', leadDays: 2, predictedOccupancy: 0.7, actualOccupancy: 0.9, activeFactorKeys: ['special:obon', 'school:summer'] }],
      new Map()
    )
    expect(r.coefficients.get('special:obon')!.value).toBeCloseTo(FACTOR_DEFAULTS['special:obon'] + 0.3 * 0.1, 6)
    expect(r.coefficients.get('school:summer')!.value).toBeCloseTo(FACTOR_DEFAULTS['school:summer'] + 0.3 * 0.1, 6)
  })

  it('リードタイム 15 日以上のサンプルは係数更新に使わないが、校正には使う', () => {
    const r = applyLearning(
      [{ stayDate: '2026-10-01', leadDays: 30, predictedOccupancy: 0.5, actualOccupancy: 0.8, activeFactorKeys: ['event:high'] }],
      new Map()
    )
    expect(r.updates).toHaveLength(0)
    expect(r.calibration[0].bucket).toBe('lead8_30')
    expect(r.calibration[0].after).toBeGreaterThan(FACTOR_DEFAULTS['calib:lead8_30'])
  })

  it('係数は ±0.3 の範囲に収める', () => {
    let state = new Map()
    for (let i = 0; i < 50; i++) {
      state = applyLearning(
        [{ stayDate: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, leadDays: 1, predictedOccupancy: 0.2, actualOccupancy: 1, activeFactorKeys: ['event:high'] }],
        state
      ).coefficients
    }
    expect(state.get('event:high')!.value).toBeLessThanOrEqual(0.3)
  })
})

describe('summarizeAccuracy', () => {
  it('リードタイム区分ごとに MAPE・バイアス・base のみの MAPE を返す', () => {
    const r = summarizeAccuracy([
      { stayDate: 'a', leadDays: 1, predictedOccupancy: 0.9, actualOccupancy: 1.0, activeFactorKeys: [], baseOccupancy: 0.8 },
      { stayDate: 'b', leadDays: 2, predictedOccupancy: 0.5, actualOccupancy: 0.4, activeFactorKeys: [], baseOccupancy: 0.5 },
      { stayDate: 'c', leadDays: 20, predictedOccupancy: 0.6, actualOccupancy: 0.6, activeFactorKeys: [] },
    ])
    expect(r.map((x) => x.bucket)).toEqual(['lead0_3', 'lead8_30'])
    const near = r[0]
    expect(near.samples).toBe(2)
    expect(near.mape).toBeCloseTo((0.1 / 1.0 + 0.1 / 0.4) / 2, 6)
    expect(near.bias).toBeCloseTo((0.1 - 0.1) / 2, 6)
    expect(near.baselineMape).toBeCloseTo((0.2 / 1.0 + 0.1 / 0.4) / 2, 6)
    expect(r[1].baselineMape).toBeNull()
  })
})
