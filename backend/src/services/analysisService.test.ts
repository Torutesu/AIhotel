import { describe, it, expect } from 'vitest'
import { aggregateChannels, aggregateDayOfWeek, aggregateRoomTypes } from './analysisService.js'

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day))

describe('aggregateChannels（#88）', () => {
  it('チャネルごとに合計し、売上の構成比・ADR・前月比を出して売上順に並べる', () => {
    const rows = aggregateChannels(
      [
        { channel: '楽天', roomsSold: 10, revenue: 150_000 },
        { channel: '公式', roomsSold: 20, revenue: 400_000 },
        { channel: '楽天', roomsSold: 10, revenue: 150_000 },
      ],
      [
        { channel: '公式', revenue: 320_000 },
        { channel: 'じゃらん', revenue: 50_000 },
      ]
    )
    expect(rows).toEqual([
      { channel: '公式', roomsSold: 20, revenue: 400_000, adr: 20_000, revenueShare: 57.1, revenueGrowth: 25 },
      { channel: '楽天', roomsSold: 20, revenue: 300_000, adr: 15_000, revenueShare: 42.9, revenueGrowth: null },
    ])
  })
})

describe('aggregateRoomTypes（#88）', () => {
  it('部屋タイプの室数と実績日数から稼働率を出し、実績の無いタイプも0で返す', () => {
    const rows = aggregateRoomTypes(
      [
        { id: 't1', name: 'ツイン', code: 'TWN', count: 10 },
        { id: 't2', name: 'スイート', code: 'STE', count: 2 },
      ],
      [
        { roomTypeId: 't1', soldRooms: 8, revenue: 160_000 },
        { roomTypeId: 't1', soldRooms: 6, revenue: 120_000 },
      ],
      2
    )
    expect(rows[0]).toMatchObject({ soldRooms: 14, revenue: 280_000, adr: 20_000, occupancy: 0.7 })
    expect(rows[1]).toMatchObject({ soldRooms: 0, revenue: 0, adr: null, occupancy: 0 })
  })
})

describe('aggregateDayOfWeek（#88）', () => {
  it('曜日ごとに集計し、週末はホテルの週末定義で判定する', () => {
    // 2026-09-04（金）と 2026-09-11（金）、2026-09-06（日）
    const rows = aggregateDayOfWeek(
      [
        { date: d(2026, 9, 4), soldRooms: 90, totalRevenue: 2_250_000 },
        { date: d(2026, 9, 11), soldRooms: 70, totalRevenue: 1_750_000 },
        { date: d(2026, 9, 6), soldRooms: 40, totalRevenue: 600_000 },
      ],
      100,
      [5, 6]
    )
    expect(rows[5]).toEqual({
      dayOfWeek: 5, isWeekend: true, days: 2, soldRooms: 160, revenue: 4_000_000, occupancy: 0.8, adr: 25_000, revPar: 20_000,
    })
    expect(rows[0]).toMatchObject({ isWeekend: false, days: 1, occupancy: 0.4 })
    expect(rows[1]).toMatchObject({ days: 0, occupancy: null, adr: null })
  })
})
