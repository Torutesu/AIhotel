import { describe, it, expect } from 'vitest'
import { estimateSigma, buildPriceResponse, occupancyAt, type ElasticitySample } from './priceResponse.js'

// 真の σ=0.5 で生成した観測から σ を復元できるか
function generate(trueSigma: number, n: number): ElasticitySample[] {
  const out: ElasticitySample[] = []
  for (let i = 0; i < n; i++) {
    const ref = 20000
    const applied = ref * (0.8 + (i % 5) * 0.1) // 0.8〜1.2 倍
    const D = 0.6 + (i % 3) * 0.1
    const m = buildPriceResponse(ref, D, trueSigma)
    out.push({ referencePrice: ref, referenceOccupancy: D, appliedPrice: applied, actualOccupancy: occupancyAt(m, applied) })
  }
  return out
}

describe('estimateSigma', () => {
  it('価格を動かした日が8件未満なら null', () => {
    expect(estimateSigma(generate(0.5, 5))).toBeNull()
  })

  it('価格を動かしていない日は情報が無いので除外する', () => {
    const flat: ElasticitySample[] = Array.from({ length: 20 }, () => ({ referencePrice: 20000, referenceOccupancy: 0.7, appliedPrice: 20000, actualOccupancy: 0.7 }))
    expect(estimateSigma(flat)).toBeNull()
  })

  it('観測から真の σ をグリッド精度で復元する', () => {
    const r = estimateSigma(generate(0.5, 20))!
    expect(r).not.toBeNull()
    expect(Math.abs(r.sigma - 0.5)).toBeLessThanOrEqual(0.05)
    expect(r.samples).toBe(16) // 1.0 倍の日（i%5===2）は除外
  })
})
