import { describe, expect, it } from 'vitest'
import { reservationsToCurve } from './reservationCurve.js'

// 予約明細からブッキングカーブを作る（D-13）
describe('reservationsToCurve', () => {
  const rows = [
    { bookedDate: '2026-09-01', checkInDate: '2026-12-01', nights: 2, rooms: 3 }, // 12/1・12/2 の泊
    { bookedDate: '2026-11-20', checkInDate: '2026-12-01', nights: 1, rooms: 2 },
    { bookedDate: '2026-10-01', checkInDate: '2026-12-01', nights: 1, rooms: 5, cancelledDate: '2026-11-25' }, // 11/25 に取消
    { bookedDate: '2026-11-30', checkInDate: '2026-12-02', nights: 1, rooms: 1 },
  ]
  const curve = reservationsToCurve(rows, '2026-12-01', '2026-12-02', [0, 1, 7, 30, 90])
  const at = (stayDate: string, lead: number) => curve.find((p) => p.stayDate === stayDate && p.daysBefore === lead)?.roomsBooked

  it('その時点で予約済み・未取消の室数を数える', () => {
    expect(at('2026-12-01', 90)).toBe(3) // 9/2 時点: 9/1 の3室
    expect(at('2026-12-01', 30)).toBe(8) // 11/1 時点: 3室 + 10/1 の5室（まだ取り消されていない）
    expect(at('2026-12-01', 7)).toBe(10) // 11/24 時点: 3 + 2（11/20）+ 5
    expect(at('2026-12-01', 1)).toBe(5) // 11/30 時点: 5室は 11/25 に取消
    expect(at('2026-12-01', 0)).toBe(5)
  })

  it('連泊はどの泊にも数え、範囲外の泊は作らない', () => {
    expect(at('2026-12-02', 0)).toBe(4) // 3室（連泊の2泊目）+ 1室
    expect(at('2026-12-02', 7)).toBe(3)
    expect(curve.every((p) => p.stayDate >= '2026-12-01' && p.stayDate <= '2026-12-02')).toBe(true)
  })

  it('明細の一番古い予約日より前の時点は作らない（0室と区別できないため）', () => {
    const late = reservationsToCurve([{ bookedDate: '2026-11-01', checkInDate: '2026-12-01', nights: 1, rooms: 1 }], '2026-12-01', '2026-12-01', [0, 30, 90])
    expect(late.map((p) => p.daysBefore)).toEqual([0, 30])
  })
})
