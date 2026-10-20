import { describe, it, expect } from 'vitest'
import { aggregatePerformance, type PerformanceLastYear } from './monthPerformance.js'

// 曜日別・日のタイプ別パフォーマンス（2026-10 PDF c分析01実績推移2）: 当月以降は実績＋予約、前年同曜日と比べる

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day))

describe('aggregatePerformance', () => {
  const lastYear = new Map<number, PerformanceLastYear>([
    [d(2025, 10, 3).getTime(), { date: d(2025, 10, 3), soldRooms: 80, revenue: 1_600_000 }],
    [d(2025, 10, 10).getTime(), { date: d(2025, 10, 10), soldRooms: 60, revenue: 1_200_000 }],
  ])

  it('販売室数は実績＋予約、ADR・REV-Per・売上は実績の日だけで出す', () => {
    const row = aggregatePerformance(
      [
        { date: d(2026, 10, 2), soldRooms: 90, revenue: 2_250_000, onHandRooms: null }, // 結果
        { date: d(2026, 10, 9), soldRooms: null, revenue: null, onHandRooms: 50 }, // 予約
        { date: d(2026, 10, 16), soldRooms: null, revenue: null, onHandRooms: null }, // 記録なし（数えない）
      ],
      lastYear,
      100
    )
    expect(row).toMatchObject({ days: 2, actualDays: 1, soldRooms: 140, onHandRooms: 50, revenue: 2_250_000, occupancy: 0.7, adr: 25_000, revPar: 22_500 })
    expect(row.dates).toEqual(['2026-10-02', '2026-10-09'])
    // 前年同曜日（364日前）の 10/3・10/10
    expect(row.lastYear).toEqual({ days: 2, soldRooms: 140, revenue: 2_800_000, occupancy: 0.7, adr: 20_000 })
  })

  it('記録が1日も無ければ稼働・ADR は null', () => {
    expect(aggregatePerformance([], new Map(), 100)).toMatchObject({ days: 0, occupancy: null, adr: null, revPar: null, lastYear: null })
  })
})
