import { describe, it, expect } from 'vitest'
import { aggregateChannels, aggregateRoomTypes, onHandMetrics } from './analysisService.js'

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

describe('onHandMetrics（予約実数 — 2026-10）', () => {
  it('結果の出ていない日は今の予約室数を返し、過去の日・記録の無い日は null', () => {
    const today = d(2026, 10, 20)
    const stay = d(2026, 10, 25)
    const points = [{ stayDate: stay, daysBefore: 5, roomsBooked: 42 }]
    expect(onHandMetrics(stay, today, points, 100)).toEqual({ soldRooms: 42, occupancy: 0.42, adr: null, revPar: null, revenue: null })
    expect(onHandMetrics(d(2026, 10, 19), today, points, 100)).toBeNull()
    expect(onHandMetrics(stay, today, [], 100)).toBeNull()
  })
})
