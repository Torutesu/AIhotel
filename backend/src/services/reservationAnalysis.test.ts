import { describe, expect, it } from 'vitest'
import { aggregateBookingWindows, aggregateGuestCounts, aggregateStayDateCurve, aggregateStayMonthCurve, type ReservationRecord } from './reservationAnalysis.js'

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

describe('aggregateStayDateCurve（宿泊日のカーブの系列）', () => {
  const date = d('2026-12-10')
  const rows = [
    r({ bookedDate: d('2026-11-30'), rooms: 2, revenue: 40000, guests: 2 }), // 10日前・1名×2室
    r({ bookedDate: d('2026-12-08'), checkInDate: d('2026-12-09'), nights: 2, revenue: 60000, guests: 2 }), // 2日前・1泊3万円
    r({ bookedDate: d('2026-11-01'), cancelledDate: d('2026-12-05') }), // 5日前に取消
    r({ bookedDate: d('2026-12-01'), checkInDate: d('2026-12-11') }), // 別の日
  ]
  const lastYear = [r({ bookedDate: d('2025-12-01'), checkInDate: d('2025-12-11') })] // 364日前（同じ曜日）
  const result = aggregateStayDateCurve(rows, lastYear, date)
  const at = (n: number) => result.points.find((p) => p.daysBefore === n)!

  it('残日数ごとに予約済み・未取消の室数を数え、取消は取消日から外す', () => {
    expect(result.reservations).toBe(3)
    expect(at(40)).toMatchObject({ rooms: 0 })
    expect(at(39)).toMatchObject({ rooms: 1 })
    expect(at(10)).toMatchObject({ rooms: 3 })
    expect(at(5)).toMatchObject({ rooms: 2 })
    expect(at(0)).toMatchObject({ rooms: 3 })
  })

  it('ADR は1泊あたりの室料、利用人数は1室あたりで分け、前年は364日前', () => {
    expect(at(0).adr).toBe(Math.round((40000 + 30000) / 3))
    expect(at(0).segments['1名']).toEqual({ rooms: 2, adr: 20000 })
    expect(at(0).segments['2名']).toEqual({ rooms: 1, adr: 30000 })
    expect(at(0).lastYearRooms).toBe(1)
    expect(at(30).adr).toBe(20000)
    expect(aggregateStayDateCurve(rows, [], date).points[0].lastYearRooms).toBeNull()
    // 未来の時点は作らない（今日が宿泊日の3日前なら、残日数3日まで）
    expect(aggregateStayDateCurve(rows, [], date, 3).points.at(-1)?.daysBefore).toBe(3)
  })
})

describe('aggregateStayMonthCurve（月単位のブッキングカーブ）', () => {
  const rows = [
    r({ bookedDate: d('2026-08-15'), checkInDate: d('2026-12-10'), rooms: 2 }), // 4か月前の月に予約
    r({ bookedDate: d('2026-11-20'), checkInDate: d('2026-12-05') }), // 前月
    r({ bookedDate: d('2026-12-03'), checkInDate: d('2026-12-20'), nights: 2 }), // 宿泊月の中
    r({ bookedDate: d('2026-10-01'), checkInDate: d('2026-12-15'), cancelledDate: d('2026-12-20') }), // 泊のあとの取消は関係ない
  ]
  const result = aggregateStayMonthCurve(rows, [], d('2026-12-01'), d('2027-01-01'))
  const k = (n: number) => result.points.find((p) => p.monthsBefore === n)!

  it('残月数ごとの累積と、その月に入った室数', () => {
    expect(result.points.map((p) => p.monthsBefore)).toEqual([6, 5, 4, 3, 2, 1, 0])
    // 残月数 k の時点 = 宿泊月の1日の (k-1) か月前の1日（k=1 は 12/1、k=4 は 9/1）
    expect(k(5).cumulative).toBe(0) // 8/1 時点ではまだ
    expect(k(4)).toMatchObject({ cumulative: 2, monthly: 2 }) // 9/1 時点（8月に入った2室）
    expect(k(3)).toMatchObject({ cumulative: 3, monthly: 1 }) // 10/1 時点（10/1 の予約を含む）
    expect(k(1)).toMatchObject({ cumulative: 4, monthly: 1 }) // 12/1 時点
    expect(k(0)).toMatchObject({ cumulative: 6, monthly: 2 }) // 月末: 12/3 の2泊。泊のあとの取消は数えたまま
    expect(k(0).lastYearCumulative).toBeNull()
    expect(k(0).segments).toMatchObject({ '1名': 2, '2名': 4 }) // 2室2名は1室1名
  })
})
