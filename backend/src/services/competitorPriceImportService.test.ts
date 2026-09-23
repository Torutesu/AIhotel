import { describe, it, expect } from 'vitest'
import { findCompetitorPriceRowErrors } from './competitorPriceImportService.js'
import { buildRepresentative } from './competitorRates/representative.js'
import { findOtbRowErrors } from './otbImportService.js'

const ids = new Map([
  ['競合A', 'ca'],
  ['競合B', 'cb'],
])

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

describe('buildRepresentative (#9 段階B)', () => {
  const at = (iso: string) => new Date(iso)
  const obs = (source: string, observedAt: string, p: Partial<{ price1P: number; price2P: number; soldOut: boolean }> = {}) => ({
    source,
    price1P: p.price1P ?? null,
    price2P: p.price2P ?? null,
    price3P: null,
    soldOut: p.soldOut ?? false,
    observedAt: at(observedAt),
  })

  it('取得元ごとの最新の値を使い、人数ごとの最安値にする', () => {
    const rep = buildRepresentative([
      obs('rakuten', '2026-09-22T18:00:00Z', { price1P: 13000 }), // 古い楽天の値は使わない
      obs('rakuten', '2026-09-23T03:00:00Z', { price1P: 12000, price2P: 20000 }),
      obs('jalan', '2026-09-23T02:00:00Z', { price1P: 11000 }),
    ])
    expect(rep).toMatchObject({ price1P: 11000, price2P: 20000, soldOut: false, sources: ['jalan', 'rakuten'] })
    expect(rep!.observedAt).toEqual(at('2026-09-23T03:00:00Z'))
  })

  it('最新の観測から48時間より古い取得元は外す（取得が止まった取得元の古い最安値を残さない）', () => {
    const rep = buildRepresentative([
      obs('official', '2026-09-20T00:00:00Z', { price1P: 5000 }),
      obs('rakuten', '2026-09-23T00:00:00Z', { price1P: 12000 }),
    ])
    expect(rep).toMatchObject({ price1P: 12000, sources: ['rakuten'] })
  })

  it('全取得元が満室なら満室、1つでも料金があれば満室にしない。観測が無ければ null', () => {
    expect(buildRepresentative([obs('rakuten', '2026-09-23T00:00:00Z', { soldOut: true }), obs('jalan', '2026-09-23T00:00:00Z', { soldOut: true })])).toMatchObject({ soldOut: true, price1P: null })
    expect(buildRepresentative([obs('rakuten', '2026-09-23T00:00:00Z', { soldOut: true }), obs('jalan', '2026-09-23T00:00:00Z', { price1P: 9000 })])).toMatchObject({ soldOut: false, price1P: 9000 })
    expect(buildRepresentative([])).toBeNull()
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
