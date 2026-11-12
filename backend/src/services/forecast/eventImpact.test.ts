import { describe, expect, it } from 'vitest'
import { computeMarketImpact } from './eventImpact.js'

// 市場の動きの補正（D-13）: 期間が重なる動きを、上がる・下がる × 大きさで足し、±6pt までに抑える
const d = (s: string) => new Date(`${s}T00:00:00Z`)
const signal = (direction: string, magnitude: string, from = '2026-12-01', to = '2026-12-31') => ({
  periodStart: d(from),
  periodEnd: d(to),
  direction,
  magnitude,
})

describe('computeMarketImpact', () => {
  it('期間の中の日だけに、上がる・下がるの向きで足す', () => {
    expect(computeMarketImpact([signal('up', 'medium')], d('2026-12-10'))).toEqual({ impact: 0.03, count: 1 })
    expect(computeMarketImpact([signal('up', 'medium')], d('2027-01-01'))).toEqual({ impact: 0, count: 0 })
    expect(computeMarketImpact([signal('up', 'medium'), signal('down', 'low')], d('2026-12-10'))).toEqual({ impact: 0.02, count: 2 })
    expect(computeMarketImpact([signal('neutral', 'high')], d('2026-12-10'))).toEqual({ impact: 0, count: 0 })
  })
  it('合計は ±6pt まで', () => {
    expect(computeMarketImpact([signal('up', 'high'), signal('up', 'high')], d('2026-12-10')).impact).toBe(0.06)
    expect(computeMarketImpact([signal('down', 'high'), signal('down', 'medium')], d('2026-12-10')).impact).toBe(-0.06)
  })
})
