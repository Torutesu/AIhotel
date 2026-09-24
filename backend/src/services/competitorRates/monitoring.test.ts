import { describe, it, expect } from 'vitest'
import { buildPriceMoveAlerts, detectPriceMoves } from './monitoring.js'
import type { RepresentativeChange } from './representative.js'

// 競合価格の変動の監視（#9 段階C）

const today = new Date('2026-10-01T00:00:00Z')
const day = (offset: number) => new Date(today.getTime() + offset * 86_400_000)

function change(
  offset: number,
  before: Partial<RepresentativeChange['before']>,
  after: Partial<RepresentativeChange['after']>,
  competitorId = 'c1'
): RepresentativeChange {
  const base = { price1P: null, price2P: null, soldOut: false }
  return { competitorId, stayDate: day(offset), before: { ...base, ...before }, after: { ...base, ...after } }
}

describe('detectPriceMoves', () => {
  it('比較人数の料金が10%以上動いた日と、新たに満室になった日だけを拾う', () => {
    const moves = detectPriceMoves(
      [
        change(3, { price1P: 10000 }, { price1P: 8900 }), // -11%
        change(4, { price1P: 10000 }, { price1P: 9500 }), // -5% は拾わない
        change(5, { price1P: 10000 }, { price1P: 11000 }), // +10%
        change(6, { price1P: 10000 }, { soldOut: true }),
        change(7, { soldOut: true }, { price1P: 10000 }), // 販売再開は拾わない
      ],
      1,
      today
    )
    expect(moves.map((m) => [m.stayDate.getTime(), m.kind])).toEqual([
      [day(3).getTime(), 'drop'],
      [day(5).getTime(), 'rise'],
      [day(6).getTime(), 'soldOut'],
    ])
  })

  it('比較人数が2名なら2名料金で判定し、過去日と監視範囲より先は無視する', () => {
    const moves = detectPriceMoves(
      [
        change(1, { price1P: 10000, price2P: 20000 }, { price1P: 5000, price2P: 19500 }), // 2名では -2.5%
        change(-1, { price2P: 20000 }, { price2P: 10000 }),
        change(60, { price2P: 20000 }, { price2P: 10000 }),
        change(59, { price2P: 20000 }, { price2P: 10000 }),
      ],
      2,
      today
    )
    expect(moves.map((m) => m.stayDate.getTime())).toEqual([day(59).getTime()])
  })
})

describe('buildPriceMoveAlerts', () => {
  const now = new Date('2026-10-01T03:00:00Z')

  it('競合ごとに1件にまとめ、14日以内の変化があれば Level 4', () => {
    const moves = detectPriceMoves(
      [
        change(3, { price1P: 10000 }, { price1P: 8000 }),
        change(6, { price1P: 10000 }, { soldOut: true }),
        change(30, { price1P: 10000 }, { price1P: 12000 }, 'c2'),
      ],
      1,
      today
    )
    const alerts = buildPriceMoveAlerts(moves, new Map([['c1', '競合A'], ['c2', '競合B']]), 1, today, now)
    expect(alerts).toHaveLength(2)
    expect(alerts[0]).toMatchObject({
      ruleKey: 'COMPETITOR_PRICE_MOVE:c1:2026-10-01T03:00:00.000Z',
      level: 4,
      title: '競合「競合A」の価格が動きました（値下げ1日・満室1日）',
      targetDate: day(3),
    })
    expect(alerts[0].message).toContain('10/4 ¥10,000→¥8,000（-20%）、10/7 満室')
    expect(alerts[1]).toMatchObject({ level: 3, title: '競合「競合B」の価格が動きました（値上げ1日）' })
  })

  it('6日以上の変化は5日まで並べて残りを件数で示す', () => {
    const moves = detectPriceMoves(
      Array.from({ length: 7 }, (_, i) => change(20 + i, { price1P: 10000 }, { price1P: 7000 })),
      1,
      today
    )
    const [alert] = buildPriceMoveAlerts(moves, new Map([['c1', '競合A']]), 1, today, now)
    expect(alert.message).toContain('ほか2日')
  })
})
