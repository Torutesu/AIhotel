import { describe, it, expect } from 'vitest'
import { aggregateCompetitorPrices, findCompetitorPriceRowErrors } from './competitorPriceImportService.js'
import { findOtbRowErrors } from './otbImportService.js'

const ids = new Map([
  ['競合A', 'ca'],
  ['競合B', 'cb'],
])
const NOW = new Date('2026-09-23T03:00:00Z')

describe('findCompetitorPriceRowErrors (#9)', () => {
  it('未登録の競合・料金と満室の矛盾・料金なし・重複を行番号つきで返す', () => {
    const errors = findCompetitorPriceRowErrors(
      [
        { competitorName: '競合X', date: '2026-10-01', price1P: 10000 },
        { competitorName: '競合A', date: '2026-10-01', price1P: 10000, soldOut: true },
        { competitorName: '競合A', date: '2026-10-02' },
        { competitorName: '競合B', date: '2026-10-01', price1P: 9000, source: 'rakuten' },
        { competitorName: '競合B', date: '2026-10-01', price1P: 9500, source: 'rakuten' },
      ],
      ids
    )
    expect(errors.map((e) => e.field)).toEqual([
      'rows.0.competitorName',
      'rows.1.soldOut',
      'rows.2.price1P',
      'rows.4.date',
    ])
  })
})

describe('aggregateCompetitorPrices (#9)', () => {
  it('同じ競合・同じ日は人数ごとの最安値にまとめ、取得日時は最も新しいものにする', () => {
    const [a] = aggregateCompetitorPrices(
      [
        { competitorName: '競合A', date: '2026-10-01', price1P: 12000, price2P: 20000, source: 'rakuten', observedAt: '2026-09-23T01:00:00+09:00' },
        { competitorName: '競合A', date: '2026-10-01', price1P: 11000, source: 'jalan', observedAt: '2026-09-23T02:00:00+09:00' },
      ],
      ids,
      NOW
    )
    expect(a).toMatchObject({ competitorId: 'ca', price1P: 11000, price2P: 20000, price3P: null, soldOut: false, sources: ['jalan', 'rakuten'] })
    expect(a.observedAt.toISOString()).toBe('2026-09-22T17:00:00.000Z')
  })

  it('全取得元が満室なら満室。1つでも料金があれば満室にしない。取得日時が無ければ取り込み時刻', () => {
    const result = aggregateCompetitorPrices(
      [
        { competitorName: '競合A', date: '2026-10-01', soldOut: true, source: 'rakuten' },
        { competitorName: '競合A', date: '2026-10-01', soldOut: true, source: 'jalan' },
        { competitorName: '競合B', date: '2026-10-01', soldOut: true, source: 'rakuten' },
        { competitorName: '競合B', date: '2026-10-01', price1P: 9000, source: 'official' },
      ],
      ids,
      NOW
    )
    expect(result.find((r) => r.competitorId === 'ca')).toMatchObject({ soldOut: true, price1P: null })
    expect(result.find((r) => r.competitorId === 'cb')).toMatchObject({ soldOut: false, price1P: 9000 })
    expect(result[0].observedAt).toEqual(NOW)
  })
})

describe('findOtbRowErrors (#24 E2)', () => {
  it('取込日より前の宿泊日・客室数超え・重複を弾く', () => {
    const errors = findOtbRowErrors(
      [
        { stayDate: '2026-09-22', roomsBooked: 10 },
        { stayDate: '2026-09-23', roomsBooked: 101 },
        { stayDate: '2026-09-24', roomsBooked: 10 },
        { stayDate: '2026-09-24', roomsBooked: 12 },
      ],
      '2026-09-23',
      100
    )
    expect(errors.map((e) => e.field)).toEqual(['rows.0.stayDate', 'rows.1.roomsBooked', 'rows.3.stayDate'])
  })
})
