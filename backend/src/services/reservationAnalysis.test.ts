import { describe, expect, it } from 'vitest'
import { aggregateBookingWindows, aggregateGuestCounts, type ReservationRecord } from './reservationAnalysis.js'

// 予約明細の集計（D-13）: 対象月の泊をリードタイム・利用人数で分ける
const d = (s: string) => new Date(`${s}T00:00:00Z`)
const r = (over: Partial<ReservationRecord>): ReservationRecord => ({
  bookedDate: d('2026-11-01'),
  checkInDate: d('2026-12-10'),
  nights: 1,
  rooms: 1,
  guests: 2,
  revenue: 20000,
  cancelledDate: null,
  ...over,
})
const month = { start: d('2026-12-01'), end: d('2027-01-01'), totalRooms: 10 }

describe('aggregateBookingWindows', () => {
  const rows = [
    r({ bookedDate: d('2026-12-10') }), // 当日
    r({ bookedDate: d('2026-12-08'), rooms: 2, revenue: 50000, guests: 4 }), // 1-3日前
    r({ bookedDate: d('2026-11-01'), checkInDate: d('2026-12-30'), nights: 3, revenue: 60000 }), // 31-60日前。12/30・12/31 の2泊だけが対象月
    r({ bookedDate: d('2026-12-07'), cancelledDate: d('2026-12-09') }), // 1-3日前のキャンセル
  ]
  const result = aggregateBookingWindows({ rows, lastYearRows: [], ...month })

  it('リードタイム別に販売室数・ADR・構成比・CXL率を出し、月をまたぐ連泊は対象月の泊だけを数える', () => {
    const sameDay = result.bookings.find((b) => b.window === '当日')!
    expect(sameDay).toMatchObject({ soldRooms: 1, adr: 20000, dor: 2, cancelRate: 0 })
    const short = result.bookings.find((b) => b.window === '1-3日前')!
    expect(short).toMatchObject({ soldRooms: 2, adr: 25000, guestUnitPrice: 12500, dor: 2 })
    expect(short.cancelRate).toBeCloseTo(33.3, 1) // 取消1室 ÷（2 + 1）
    const long = result.bookings.find((b) => b.window === '31-60日前')!
    expect(long).toMatchObject({ soldRooms: 2, revenue: 40000, avgNights: 3 })
    // 室料の構成比: 20,000 + 50,000 + 40,000 = 110,000
    expect(sameDay.revenueShare).toBeCloseTo(18.2, 1)
    expect(result.bookings.every((b) => b.yoy === null)).toBe(true) // 前年の明細が無い
  })

  it('キャンセルの表は取消の室数と構成比', () => {
    const c = result.cancels.find((x) => x.window === '1-3日前')!
    expect(c).toMatchObject({ rooms: 1, share: 100, revenue: 20000 })
  })

  it('前年同月の明細があれば前年同月比を出す', () => {
    const withLastYear = aggregateBookingWindows({
      rows,
      lastYearRows: [r({ bookedDate: d('2025-12-10'), checkInDate: d('2025-12-10'), revenue: 10000 })],
      ...month,
    })
    expect(withLastYear.bookings.find((b) => b.window === '当日')!.yoy).toBe(100)
  })
})

describe('aggregateGuestCounts', () => {
  it('1室あたりの人数で分け、区分ごとに月の予約の積み上がりを出す', () => {
    const result = aggregateGuestCounts({
      rows: [
        r({ guests: 1 }),
        r({ guests: 4, rooms: 2, bookedDate: d('2026-12-01') }),
        r({ guests: null }),
      ],
      lastYearRows: [],
      ...month,
    })
    const names = result.segments.map((s) => s.name)
    expect(names).toEqual(['1名', '2名', '3名', '4名以上', '人数不明'])
    expect(result.segments.find((s) => s.name === '2名')).toMatchObject({ soldRooms: 2, dor: 2 })
    const one = result.segments.find((s) => s.name === '1名')!
    // 11/1 に予約 → 12/10 の30日前（11/10）にはもう入っている。当日予約の 2名 は 30日前には無い
    expect(one.curve.find((c) => c.lead === 30)?.rooms).toBe(1)
    expect(result.segments.find((s) => s.name === '2名')!.curve.find((c) => c.lead === 30)?.rooms).toBe(0)
  })
})
