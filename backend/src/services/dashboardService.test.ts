import { describe, it, expect } from 'vitest'
import { computeSummary, type ActualDayRecord } from './dashboardService.js'

describe('computeSummary', () => {
  it('DOR は 宿泊人数 / 販売室数（1室あたり平均利用人数）で算出する', () => {
    // 3日分・販売室数合計 300室・宿泊人数合計 480人 → DOR = 1.6人/室
    const days: ActualDayRecord[] = [
      { totalRevenue: 1_000_000, soldRooms: 100, guests: 160 },
      { totalRevenue: 1_000_000, soldRooms: 100, guests: 160 },
      { totalRevenue: 1_000_000, soldRooms: 100, guests: 160 },
    ]
    const summary = computeSummary(days, 200)
    expect(summary.dor).toBe(1.6)
  })

  it('DOR は日数で割らない（宿泊人数の日平均にならない）', () => {
    // 旧実装は guests / 日数 = 480/3 = 160 を返していた（単位・桁が誤り）
    const days: ActualDayRecord[] = [
      { totalRevenue: 500_000, soldRooms: 80, guests: 160 },
      { totalRevenue: 500_000, soldRooms: 80, guests: 160 },
      { totalRevenue: 500_000, soldRooms: 80, guests: 160 },
    ]
    const summary = computeSummary(days, 200)
    expect(summary.dor).toBe(2)
    expect(summary.dor).not.toBe(160)
  })

  it('DOR は小数第2位に丸める', () => {
    // 100人 / 30室 = 3.3333... → 3.33
    const days: ActualDayRecord[] = [{ totalRevenue: 300_000, soldRooms: 30, guests: 100 }]
    expect(computeSummary(days, 100).dor).toBe(3.33)
  })

  it('販売室数が0なら DOR は0（ゼロ除算しない）', () => {
    const days: ActualDayRecord[] = [{ totalRevenue: 0, soldRooms: 0, guests: 0 }]
    expect(computeSummary(days, 100).dor).toBe(0)
  })

  it('実績が空なら全指標が0になる', () => {
    const summary = computeSummary([], 200)
    expect(summary).toMatchObject({
      roomRevenue: 0,
      soldRooms: 0,
      adr: 0,
      occupancyRate: 0,
      revPar: 0,
      guests: 0,
      dor: 0,
      guestUnitPrice: 0,
      actualDays: 0,
    })
  })

  it('ADR・稼働率・REV-Per・客単価を実績から算出する', () => {
    // 2日分・総売上 2,400,000円・販売室数 150室・客室数 100室(=200室ナイト)・宿泊人数 300人
    const days: ActualDayRecord[] = [
      { totalRevenue: 1_200_000, soldRooms: 75, guests: 150 },
      { totalRevenue: 1_200_000, soldRooms: 75, guests: 150 },
    ]
    const summary = computeSummary(days, 100)
    expect(summary.roomRevenue).toBe(2_400_000)
    expect(summary.adr).toBe(16_000) // 2,400,000 / 150
    expect(summary.occupancyRate).toBe(0.75) // 150 / 200
    expect(summary.revPar).toBe(12_000) // 2,400,000 / 200
    expect(summary.guestUnitPrice).toBe(8_000) // 2,400,000 / 300
    expect(summary.actualDays).toBe(2)
  })

  it('null の項目は0として集計する', () => {
    const days: ActualDayRecord[] = [
      { totalRevenue: 100_000, soldRooms: 10, guests: null },
      { totalRevenue: null, soldRooms: null, guests: 20 },
    ]
    const summary = computeSummary(days, 50)
    expect(summary.roomRevenue).toBe(100_000)
    expect(summary.soldRooms).toBe(10)
    expect(summary.guests).toBe(20)
    expect(summary.dor).toBe(2) // 20 / 10
  })
})
