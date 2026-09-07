import { describe, it, expect } from 'vitest'
import { buildFeatures, addSample, emptyRidgeState, solveWeights, predict, priorWeights, RIDGE_FEATURE_KEYS } from './ridge.js'

describe('ridge', () => {
  it('サンプルが無ければ prior（ルールベースと同じ重み）を返す', () => {
    const w = solveWeights(emptyRidgeState())
    expect(w).toEqual(priorWeights())
    const x = buildFeatures([{ key: 'base', pt: 0.7 }, { key: 'holiday:eve', pt: 0.1 }], 5)
    expect(predict(w, x)).toBeCloseTo(0.8, 6)
  })

  it('要因が系統的に効きすぎていれば、その重みが 1 より小さくなる', () => {
    let state = emptyRidgeState()
    // 祝日要因 +0.1 が半分の日に付くが実際には効かない（実績 = base）データを 240 件
    for (let i = 0; i < 240; i++) {
      const base = 0.6 + (i % 7) * 0.03
      const factors = [{ key: 'base', pt: base }]
      if (i % 2 === 0) factors.push({ key: 'holiday:eve', pt: 0.1 })
      state = addSample(state, buildFeatures(factors, i % 7), base)
    }
    const w = solveWeights(state)
    expect(w[RIDGE_FEATURE_KEYS.indexOf('holiday')]).toBeLessThan(0.5)
    expect(w[RIDGE_FEATURE_KEYS.indexOf('base')]).toBeCloseTo(1, 1)
    // 実際に効く要因（実績 = base + 0.1）なら重みは 1 付近に留まる
    let s2 = emptyRidgeState()
    for (let i = 0; i < 120; i++) {
      const base = 0.6 + (i % 7) * 0.03
      const factors = [{ key: 'base', pt: base }]
      const has = i % 2 === 0
      if (has) factors.push({ key: 'holiday:eve', pt: 0.1 })
      s2 = addSample(s2, buildFeatures(factors, i % 7), base + (has ? 0.1 : 0))
    }
    expect(solveWeights(s2)[RIDGE_FEATURE_KEYS.indexOf('holiday')]).toBeCloseTo(1, 1)
  })

  it('特徴ベクトルは要因グループごとに pt を合算し、曜日ダミーを立てる', () => {
    const x = buildFeatures([{ key: 'holiday:eve', pt: 0.1 }, { key: 'holiday:bridge', pt: 0.04 }, { key: 'unknown:x', pt: 0.5 }], 3)
    expect(x[RIDGE_FEATURE_KEYS.indexOf('holiday')]).toBeCloseTo(0.14, 6)
    expect(x[RIDGE_FEATURE_KEYS.indexOf('dow3')]).toBe(1)
    expect(x[0]).toBe(1)
  })
})
