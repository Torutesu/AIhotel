import { describe, it, expect } from 'vitest'
import {
  computeSummary,
  ratio,
  buildComparisonAxis,
  fiscalYearStart,
  aggregateBudgets,
  buildFiscalBudgetWhere,
  elapsedDaysInMonth,
  elapsedDaysInFiscalPeriod,
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

describe('buildFiscalBudgetWhere (C-1)', () => {
  it('年度開始年＝表示年なら月に上限（lte）を付ける', () => {
    // 2026年9月表示 → 2026年度（4月始まり）。4〜9月だけを対象にする
    const where = buildFiscalBudgetWhere(2026, 9, { year: 2026, month: 4 })
    expect(where).toEqual({ OR: [{ year: 2026, month: { gte: 4, lte: 9 } }] })
  })

  it('上限が欠けていると10〜12月の予算まで合算されてしまう（回帰テスト）', () => {
    const clause = buildFiscalBudgetWhere(2026, 9, { year: 2026, month: 4 }).OR[0]
    expect(clause.month.lte).toBe(9)
    expect(clause.month.lte).not.toBeUndefined()
  })

  it('年度開始月そのものを表示している場合は1か月だけが対象', () => {
    const where = buildFiscalBudgetWhere(2026, 4, { year: 2026, month: 4 })
    expect(where).toEqual({ OR: [{ year: 2026, month: { gte: 4, lte: 4 } }] })
  })

  it('年度をまたぐ（1〜3月表示）場合は前年4月以降＋当年の当月以前の2条件', () => {
    // 2026年2月表示 → 2025年度（2025年4月〜2026年2月）
    const where = buildFiscalBudgetWhere(2026, 2, { year: 2025, month: 4 })
    expect(where).toEqual({
      OR: [
        { year: 2025, month: { gte: 4 } },
        { year: 2026, month: { lte: 2 } },
      ],
    })
  })
})

describe('elapsedDaysInMonth (C-1)', () => {
  const today = new Date(Date.UTC(2026, 8, 11)) // 2026-09-11

  it('過去月はその月の日数すべて', () => {
    expect(elapsedDaysInMonth(2026, 4, today)).toBe(30)
    expect(elapsedDaysInMonth(2026, 8, today)).toBe(31)
  })

  it('当月は月初から本日まで（本日を含む）', () => {
    expect(elapsedDaysInMonth(2026, 9, today)).toBe(11)
  })

  it('未来月は0', () => {
    expect(elapsedDaysInMonth(2026, 10, today)).toBe(0)
    expect(elapsedDaysInMonth(2027, 1, today)).toBe(0)
  })

  it('月末日が本日ならその月の日数と一致する', () => {
    expect(elapsedDaysInMonth(2026, 9, new Date(Date.UTC(2026, 8, 30)))).toBe(30)
  })

  it('月初日が本日なら1日', () => {
    expect(elapsedDaysInMonth(2026, 9, new Date(Date.UTC(2026, 8, 1)))).toBe(1)
  })

  it('実績データの件数に依存せず暦日で数える', () => {
    // 実績件数ベースの旧実装では未入力日のぶんだけ按分予算が小さくなっていた
    expect(elapsedDaysInMonth(2026, 5, today)).toBe(31)
  })
})

describe('elapsedDaysInFiscalPeriod (C-1)', () => {
  const today = new Date(Date.UTC(2026, 8, 11)) // 2026-09-11

  it('年度開始月から当月までの暦日を合計する', () => {
    // 4月30 + 5月31 + 6月30 + 7月31 + 8月31 + 9月11 = 164
    expect(elapsedDaysInFiscalPeriod({ year: 2026, month: 4 }, 2026, 9, today)).toBe(164)
  })

  it('年度開始月を表示している場合はその月の経過日数のみ', () => {
    expect(
      elapsedDaysInFiscalPeriod({ year: 2026, month: 4 }, 2026, 4, new Date(Date.UTC(2026, 3, 10)))
    ).toBe(10)
  })

  it('年をまたぐ年度でも合計できる', () => {
    // 2025年4月〜2026年2月を 2026-02-10 時点で見る
    // 2025: 30+31+30+31+31+30+31+30+31 = 275 / 2026: 31 + 10 = 41 → 316
    const t = new Date(Date.UTC(2026, 1, 10))
    expect(elapsedDaysInFiscalPeriod({ year: 2025, month: 4 }, 2026, 2, t)).toBe(316)
  })
})
