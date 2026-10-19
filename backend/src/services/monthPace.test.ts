import { describe, it, expect } from 'vitest'
import { buildMonthPace, roomsAsOf } from './monthPace.js'

// 月の予約の積み上がり（日別パフォーマンスの月のグラフ — 180日前 → 結果）

const d = (s: string) => new Date(`${s}T00:00:00.000Z`)
const pts = (stay: string, list: Array<[number, number]>) => list.map(([daysBefore, roomsBooked]) => ({ stayDate: d(stay), daysBefore, roomsBooked }))

describe('roomsAsOf', () => {
  const points = pts('2026-10-01', [[90, 10], [30, 40]])
  it('残日数以上で最も近い記録を使い、結果は販売室数を優先する', () => {
    expect(roomsAsOf(points, 90, null)).toBe(10)
    expect(roomsAsOf(points, 60, null)).toBe(10)
    expect(roomsAsOf(points, 30, null)).toBe(40)
    expect(roomsAsOf(points, 5, null)).toBe(40)
    expect(roomsAsOf(points, 0, 72)).toBe(72)
    expect(roomsAsOf(points, 120, null)).toBeNull()
  })
})

describe('buildMonthPace', () => {
  const days = [
    { stayDate: d('2026-10-01'), points: pts('2026-10-01', [[90, 10], [30, 40]]), actualSoldRooms: 70, lastYear: { points: pts('2025-10-02', [[90, 8], [30, 30]]), finalRooms: 60 } },
    { stayDate: d('2026-10-02'), points: pts('2026-10-02', [[90, 20], [30, 50]]), actualSoldRooms: 80, lastYear: null },
  ]

  it('月の各日の N 日前の予約室数を足し上げ、記録が欠ける N は出さない', () => {
    const pace = buildMonthPace({ days, totalRooms: 100, today: d('2026-11-01'), maxLead: 120 })
    expect(pace[0].daysBefore).toBe(90)
    expect(pace.find((p) => p.daysBefore === 90)).toMatchObject({ rooms: 30, occupancy: 0.15 })
    expect(pace.find((p) => p.daysBefore === 30)).toMatchObject({ rooms: 90 })
    expect(pace.at(-1)).toMatchObject({ daysBefore: 0, rooms: 150, occupancy: 0.75 })
  })

  it('前年比は前年同曜日の記録がある日どうしだけで比べる', () => {
    const pace = buildMonthPace({ days, totalRooms: 100, today: d('2026-11-01'), maxLead: 120 })
    expect(pace.find((p) => p.daysBefore === 30)).toMatchObject({ comparableRooms: 40, lastYearRooms: 30 })
    expect(pace.at(-1)).toMatchObject({ comparableRooms: 70, lastYearRooms: 60 })
  })

  it('まだ N 日前に達していない宿泊日がある N は出さない（今月）', () => {
    const pace = buildMonthPace({ days, totalRooms: 100, today: d('2026-09-01'), maxLead: 120 })
    // 月末（10/2）まで残り31日 → 31日前より先だけ（31日前の値は 90日前の記録）
    expect(Math.min(...pace.map((p) => p.daysBefore))).toBe(31)
    expect(pace.at(-1)).toMatchObject({ daysBefore: 31, rooms: 30 })
    const later = buildMonthPace({ days, totalRooms: 100, today: d('2026-09-20'), maxLead: 120 })
    expect(Math.min(...later.map((p) => p.daysBefore))).toBe(12)
    expect(later.at(-1)).toMatchObject({ daysBefore: 12, rooms: 90 })
  })

  it('日が無い・客室数が無ければ空', () => {
    expect(buildMonthPace({ days: [], totalRooms: 100, today: d('2026-11-01') })).toEqual([])
    expect(buildMonthPace({ days, totalRooms: 0, today: d('2026-11-01') })).toEqual([])
  })
})
