import { describe, expect, it } from 'vitest'
import { aggregateFree, type FreeRecord } from './freeAnalysis.js'

// フリー分析（D-13）: 予約明細の対象月の泊を1〜2つの軸で分ける
const d = (s: string) => new Date(`${s}T00:00:00Z`)
const r = (over: Partial<FreeRecord>): FreeRecord => ({
  bookedDate: d('2026-11-01'),
  checkInDate: d('2026-12-07'), // 月曜
  nights: 1,
  rooms: 1,
  guests: 2,
  revenue: 20000,
  cancelledDate: null,
  channel: '楽天トラベル',
  ...over,
})
const start = d('2026-12-01')
const end = d('2027-01-01')
const rows = [
  r({}),
  r({ checkInDate: d('2026-12-12'), rooms: 2, revenue: 60000, channel: 'じゃらん', bookedDate: d('2026-12-11') }), // 土曜・1日前
  r({ checkInDate: d('2026-12-14'), nights: 2, revenue: 40000 }), // 月・火
  r({ cancelledDate: d('2026-11-20'), rooms: 5 }), // 取消は数えない
  r({ checkInDate: d('2026-12-31'), nights: 2, channel: null, revenue: null }), // 12/31 だけが対象月。室料なし
]

describe('aggregateFree', () => {
  it('単一軸: チャネル別の販売室数（多い順。チャネルの無い予約は「チャネル不明」）', () => {
    const res = aggregateFree(rows, { axis1: 'channel', metric: 'rooms' }, start, end, 10)
    expect(res.axis1Values).toEqual(['楽天トラベル', 'じゃらん', 'チャネル不明'])
    expect(res.rows).toEqual([
      { axis1: '楽天トラベル', axis2: null, value: 3 },
      { axis1: 'じゃらん', axis2: null, value: 2 },
      { axis1: 'チャネル不明', axis2: null, value: 1 },
    ])
    expect(res.reservations).toBe(4)
  })

  it('曜日の稼働率は「客室数 × その曜日の日数」で割り、ADR は室料のある泊だけ', () => {
    const occ = aggregateFree(rows, { axis1: 'dayofweek', metric: 'occupancy' }, start, end, 10)
    // 12月の月曜は 7・14・21・28 の4日 → 2室 ÷ 40
    expect(occ.rows.find((x) => x.axis1 === '月')?.value).toBe(5)
    const adr = aggregateFree(rows, { axis1: 'channel', metric: 'adr' }, start, end, 10)
    expect(adr.rows.find((x) => x.axis1 === '楽天トラベル')?.value).toBe(20000)
    expect(adr.rows.find((x) => x.axis1 === 'チャネル不明')?.value).toBeNull()
  })

  it('クロス: 予約期間 × 利用人数の予約数。空のセルは0', () => {
    const res = aggregateFree(rows, { axis1: 'booking', axis2: 'guests', metric: 'bookings' }, start, end, 10)
    expect(res.axis1Values).toEqual(['1-3日前', '31-60日前'])
    expect(res.axis2Values).toEqual(['1名', '2名'])
    expect(res.rows).toContainEqual({ axis1: '1-3日前', axis2: '1名', value: 1 }) // 2室2名
    expect(res.rows).toContainEqual({ axis1: '1-3日前', axis2: '2名', value: 0 })
    expect(res.rows).toContainEqual({ axis1: '31-60日前', axis2: '2名', value: 3 })
  })
})
