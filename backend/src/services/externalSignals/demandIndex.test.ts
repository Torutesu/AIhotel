import { describe, expect, it } from 'vitest'
import { computeDemandIndex } from './demandIndex.js'

// 月別需要指数（D-13）: 100 = 直近1年の平均稼働。季節（前年同月）＋イベント＋市場の動き
const d = (s: string) => new Date(`${s}T00:00:00Z`)

describe('computeDemandIndex', () => {
  // 直近1年の平均稼働 60%。前年8月だけ 90%
  const history: Array<{ date: Date; occupancy: number }> = []
  for (let t = d('2025-11-12').getTime(); t < d('2026-11-12').getTime(); t += 86_400_000) {
    const date = new Date(t)
    history.push({ date, occupancy: date.getUTCMonth() === 7 ? 0.9 : 0.6 })
  }

  it('前年同月の稼働で季節の指数を出し、イベントと市場の動きを平均稼働に対する割合で足す', () => {
    const [aug, dec] = computeDemandIndex({
      months: [
        { year: 2027, month: 8 },
        { year: 2026, month: 12 },
      ],
      history,
      today: d('2026-11-12'),
      events: [{ name: '大型ライブ', source: 'agent', startDate: d('2026-12-05'), endDate: d('2026-12-07'), expectedImpact: 'high' }],
      signals: [
        { kind: 'access', title: '増便', periodStart: d('2026-12-01'), periodEnd: d('2027-03-31'), direction: 'up', magnitude: 'medium' },
      ],
    })
    // 平均 = (0.9×31 + 0.6×334) / 365 ≈ 0.625 → 前年8月 0.9 ÷ 0.625 ≈ 144
    expect(aug.components.seasonal).toBeCloseTo(144, 0)
    expect(aug.seasons).toEqual(expect.arrayContaining(['夏休み', 'お盆']))
    // 12月: 前年12月は 60% → 96。イベント 0.15×3日/31日 ÷ 0.625 ≈ 2.3、市場 0.03 ÷ 0.625 ≈ 4.8
    expect(dec.components.seasonal).toBeCloseTo(96, 0)
    expect(dec.components.events).toBeCloseTo(2.3, 1)
    expect(dec.components.market).toBeCloseTo(4.8, 1)
    expect(dec.index).toBeCloseTo(96 + 2.3 + 4.8, 0)
    expect(dec.events.map((e) => e.name)).toEqual(['大型ライブ'])
    expect(dec.seasons).toContain('年末年始')
  })

  it('前年同月の実績が無ければ季節は null で、指数は 100 を基準にする', () => {
    const [m] = computeDemandIndex({ months: [{ year: 2026, month: 12 }], history: [], today: d('2026-11-12'), events: [], signals: [] })
    expect(m).toMatchObject({ index: 100, components: { seasonal: null, events: 0, market: 0 } })
  })
})
