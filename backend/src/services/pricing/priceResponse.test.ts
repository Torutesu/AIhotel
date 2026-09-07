import { describe, it, expect } from 'vitest'
import { normalCdf, normalQuantile, buildPriceResponse, occupancyAt, revParAt } from './priceResponse.js'

describe('normalCdf / normalQuantile', () => {
  it('標準正規分布の既知の値に一致する', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6)
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 4)
    expect(normalCdf(-1)).toBeCloseTo(0.1587, 3)
    expect(normalQuantile(0.975)).toBeCloseTo(1.96, 2)
  })
})

describe('buildPriceResponse', () => {
  it('基準価格での稼働率は需要予測と一致し、需要が弱ければ基準価格が収益最大になる', () => {
    const m = buildPriceResponse(20000, 0.7, 0.35)
    expect(occupancyAt(m, 20000)).toBeCloseTo(0.7, 6)
    const ref = revParAt(m, 20000)
    for (const p of [14000, 17000, 19000, 21000, 23000, 26000]) {
      expect(revParAt(m, p)).toBeLessThanOrEqual(ref + 1e-6)
    }
  })

  it('価格を上げると稼働率は単調に下がる', () => {
    const m = buildPriceResponse(20000, 0.7, 0.35)
    expect(occupancyAt(m, 18000)).toBeGreaterThan(occupancyAt(m, 20000))
    expect(occupancyAt(m, 22000)).toBeLessThan(occupancyAt(m, 20000))
  })

  it('潜在需要が客室数を超えていれば（clamp前の予測 > 1）、基準より高い価格でも満室を保ち収益最大点は上に移る', () => {
    const m = buildPriceResponse(20000, 1.2, 0.35)
    expect(occupancyAt(m, 20000)).toBe(1)
    expect(occupancyAt(m, 22000)).toBe(1)
    expect(revParAt(m, 22000)).toBeGreaterThan(revParAt(m, 20000))
  })
})
