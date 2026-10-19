import { describe, it, expect } from 'vitest'
import { allocateDailyBudget } from './budgetAllocation.js'

// 月次予算の日割り（前年同曜日の販売室数の比で配る）

describe('allocateDailyBudget', () => {
  const budget = { budgetRevenue: 1_000_000, budgetRooms: 100, budgetAdr: 10_000, budgetOccupancy: null }

  it('前年同曜日の販売室数の比で室数と売上を配り、ADR は月の値にする', () => {
    const days = allocateDailyBudget(budget, 200, [10, 30, 60])
    expect(days.map((d) => d.rooms)).toEqual([10, 30, 60])
    expect(days.map((d) => d.revenue)).toEqual([100_000, 300_000, 600_000])
    expect(days.every((d) => d.adr === 10_000)).toBe(true)
    expect(days[2]).toMatchObject({ occupancy: 0.3, revPar: 3000 })
  })

  it('前年の実績が無い日は平均の重み、1日も無ければ均等に配る', () => {
    expect(allocateDailyBudget(budget, 200, [10, null, 30]).map((d) => d.rooms)).toEqual([17, 33, 50])
    expect(allocateDailyBudget(budget, 200, [null, null, null, null]).map((d) => d.rooms)).toEqual([25, 25, 25, 25])
  })

  it('室数が無ければ稼働率×客室数×日数、ADR が無ければ売上÷室数から出す', () => {
    const days = allocateDailyBudget({ budgetRevenue: 900_000, budgetRooms: null, budgetAdr: null, budgetOccupancy: 0.5 }, 100, [1, 1, 1])
    expect(days.map((d) => d.rooms)).toEqual([50, 50, 50])
    expect(days[0].adr).toBe(6000)
    expect(days[0].revenue).toBe(300_000)
  })

  it('1日の室数は客室数で頭打ちにし、売上も同じ割合で切る', () => {
    const days = allocateDailyBudget({ budgetRevenue: 2_000_000, budgetRooms: 200, budgetAdr: 10_000, budgetOccupancy: null }, 100, [1, 3])
    expect(days[1]).toMatchObject({ rooms: 100, occupancy: 1, revenue: 1_000_000, adr: 10_000 })
    expect(days[0]).toMatchObject({ rooms: 50, revenue: 500_000 })
  })

  it('予算が無ければすべて null', () => {
    expect(allocateDailyBudget(null, 100, [1, 2])).toEqual([
      { rooms: null, occupancy: null, adr: null, revenue: null, revPar: null },
      { rooms: null, occupancy: null, adr: null, revenue: null, revPar: null },
    ])
    expect(allocateDailyBudget({ budgetRevenue: null, budgetRooms: null, budgetAdr: 12_000, budgetOccupancy: null }, 100, [1])[0]).toMatchObject({
      rooms: null,
      adr: 12_000,
      revenue: null,
    })
  })
})
