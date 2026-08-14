import { describe, it, expect } from 'vitest'
import {
  computeSummary,
  ratio,
  buildComparisonAxis,
  fiscalYearStart,
  aggregateBudgets,
  type ActualDayRecord,
  type BudgetRecord,
} from './dashboardService.js'

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

describe('ratio', () => {
  it('実績÷目標を小数第3位まで返す', () => {
    expect(ratio(1_050_000, 1_000_000)).toBe(1.05)
    expect(ratio(950, 1000)).toBe(0.95)
  })

  it('目標が0・null・実績がnullなら null を返す（ゼロ除算しない）', () => {
    expect(ratio(100, 0)).toBeNull()
    expect(ratio(100, null)).toBeNull()
    expect(ratio(null, 100)).toBeNull()
  })
})

describe('fiscalYearStart', () => {
  it('4月以降は当年度（その年の4月始まり）', () => {
    expect(fiscalYearStart(2026, 4)).toEqual({ year: 2026, month: 4 })
    expect(fiscalYearStart(2026, 12)).toEqual({ year: 2026, month: 4 })
  })

  it('1〜3月は前年度（前年の4月始まり）', () => {
    expect(fiscalYearStart(2026, 3)).toEqual({ year: 2025, month: 4 })
    expect(fiscalYearStart(2026, 1)).toEqual({ year: 2025, month: 4 })
  })

  it('年度開始月を変更できる（1月始まり=暦年）', () => {
    expect(fiscalYearStart(2026, 3, 1)).toEqual({ year: 2026, month: 1 })
  })
})

describe('buildComparisonAxis', () => {
  const actual = { revenue: 10_000_000, adr: 18_000, occupancy: 0.82 }

  it('売上・ADR・稼働率それぞれの対予算比・対前年比を返す', () => {
    const axis = buildComparisonAxis(
      actual,
      { revenue: 12_500_000, adr: 20_000, occupancy: 0.8 },
      { revenue: 8_000_000, adr: 16_000, occupancy: 0.75 }
    )
    expect(axis.budgetRevenueRatio).toBe(0.8) // 10,000,000 / 12,500,000
    expect(axis.budgetAdrRatio).toBe(0.9) // 18,000 / 20,000
    expect(axis.budgetOccupancyRatio).toBe(1.025) // 0.82 / 0.8
    expect(axis.lastYearRevenueRatio).toBe(1.25) // 10,000,000 / 8,000,000
    expect(axis.lastYearAdrRatio).toBe(1.125)
  })

  it('目標値が未設定の指標は比率が null になる', () => {
    const axis = buildComparisonAxis(
      actual,
      { revenue: null, adr: null, occupancy: null },
      { revenue: null, adr: null, occupancy: null }
    )
    expect(axis.budgetRevenueRatio).toBeNull()
    expect(axis.budgetAdrRatio).toBeNull()
    expect(axis.lastYearOccupancyRatio).toBeNull()
  })

  it('比較に使った目標値もそのまま返す（UIでの内訳表示用）', () => {
    const axis = buildComparisonAxis(
      actual,
      { revenue: 12_500_000, adr: 20_000, occupancy: 0.8 },
      { revenue: 8_000_000, adr: 16_000, occupancy: 0.75 }
    )
    expect(axis.budgetRevenue).toBe(12_500_000)
    expect(axis.lastYearAdr).toBe(16_000)
  })
})

describe('aggregateBudgets', () => {
  const budgets: BudgetRecord[] = [
    {
      budgetRevenue: 10_000_000,
      budgetRooms: 500,
      budgetAdr: 20_000,
      budgetOccupancy: 0.8,
      lastYearRevenue: 8_000_000,
      lastYearRooms: 500,
      lastYearAdr: 16_000,
      lastYearOccupancy: 0.75,
    },
    {
      budgetRevenue: 14_000_000,
      budgetRooms: 700,
      budgetAdr: 20_000,
      budgetOccupancy: 0.85,
      lastYearRevenue: 12_000_000,
      lastYearRooms: 600,
      lastYearAdr: 20_000,
      lastYearOccupancy: 0.8,
    },
  ]

  it('売上は合計、ADRは売上÷室数の加重平均で畳み込む', () => {
    const { budget, lastYear } = aggregateBudgets(budgets, 100, 30)
    expect(budget.revenue).toBe(24_000_000)
    expect(budget.adr).toBe(20_000) // 24,000,000 / 1,200室
    expect(lastYear.revenue).toBe(20_000_000)
    expect(lastYear.adr).toBe(18_182) // 20,000,000 / 1,100室
  })

  it('稼働率は 室数合計 ÷（客室数 × 期間日数）で再計算する', () => {
    // 予算室数1,200室 ÷ (100室 × 30日 = 3,000室ナイト) = 0.4
    const { budget } = aggregateBudgets(budgets, 100, 30)
    expect(budget.occupancy).toBe(0.4)
  })

  it('予算レコードが無ければ全て null', () => {
    const { budget, lastYear } = aggregateBudgets([], 100, 30)
    expect(budget.revenue).toBeNull()
    expect(budget.adr).toBeNull()
    expect(budget.occupancy).toBeNull()
    expect(lastYear.revenue).toBeNull()
  })

  it('期間日数が0なら稼働率は null（ゼロ除算しない）', () => {
    const { budget } = aggregateBudgets(budgets, 100, 0)
    expect(budget.occupancy).toBeNull()
    expect(budget.revenue).toBe(24_000_000)
  })
})
