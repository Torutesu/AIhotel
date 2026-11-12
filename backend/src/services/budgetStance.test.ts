import { describe, expect, it } from 'vitest'
import { decideBudgetStance, modelForStance, monthsBetween } from './budgetStance.js'
import { allocateDailyBudgetWithFixed } from './budgetAllocation.js'

// 月の予算への向き合い方と、日別の予算を登録した日の固定（D-13）

describe('decideBudgetStance', () => {
  const base = { budgetRevenue: 10_000_000, onBooksRevenue: 6_000_000 }
  it('届いていれば onTrack', () => {
    expect(decideBudgetStance({ ...base, leadToMonthStart: 60, projectedRevenue: 10_500_000 })?.stance).toBe('onTrack')
  })
  it('届いていなくても、月初まで30日より前なら追う（chase）', () => {
    expect(decideBudgetStance({ ...base, leadToMonthStart: 45, projectedRevenue: 8_000_000 })).toMatchObject({ stance: 'chase', gap: 2_000_000 })
  })
  it('30日を切って、不足が残りの見込みの20%を超えれば未達前提（giveUp）', () => {
    // 残りの見込み = 8,000,000 − 6,000,000 = 2,000,000 → 伸びしろ 400,000 < 不足 2,000,000
    expect(decideBudgetStance({ ...base, leadToMonthStart: 20, projectedRevenue: 8_000_000 })).toMatchObject({ stance: 'giveUp', stretch: 400_000 })
    // 不足が伸びしろの中なら追う
    expect(decideBudgetStance({ ...base, leadToMonthStart: 20, projectedRevenue: 9_800_000 })?.stance).toBe('chase')
  })
  it('3か月より先の月・予算や見込みの無い月は判定しない', () => {
    expect(decideBudgetStance({ ...base, leadToMonthStart: 120, projectedRevenue: 8_000_000 })).toBeNull()
    expect(decideBudgetStance({ ...base, budgetRevenue: null, leadToMonthStart: 10, projectedRevenue: 8_000_000 })).toBeNull()
    expect(decideBudgetStance({ ...base, leadToMonthStart: 10, projectedRevenue: null })).toBeNull()
  })
  it('追う月だけ優先モデルを1段稼働寄りにする', () => {
    expect(modelForStance('adr', 'chase')).toBe('balanced')
    expect(modelForStance('balanced', 'chase')).toBe('occupancy')
    expect(modelForStance('adr', 'giveUp')).toBe('adr')
    expect(modelForStance(null, 'chase')).toBeNull()
  })
  it('期間に含まれる月', () => {
    expect(monthsBetween(new Date('2026-11-20T00:00:00Z'), new Date('2027-01-05T00:00:00Z'))).toEqual([
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
    ])
  })
})

describe('allocateDailyBudgetWithFixed', () => {
  const budget = { budgetRevenue: 300_000, budgetRooms: 30, budgetAdr: null, budgetOccupancy: null }
  it('登録した日はその値、残りの予算をほかの日に重みの比で配る', () => {
    const r = allocateDailyBudgetWithFixed(budget, 100, [1, 1, 2], [{ rooms: 10, revenue: 150_000 }, null, null])
    expect(r[0]).toMatchObject({ rooms: 10, revenue: 150_000, adr: 15_000 })
    // 残り 20室・150,000円を 1:2 で配る
    expect(r[1].rooms! + r[2].rooms!).toBe(20)
    expect(r[2].revenue).toBeGreaterThan(r[1].revenue!)
    expect(r[1].revenue! + r[2].revenue!).toBeCloseTo(150_000, -1)
  })
  it('月の予算が無ければ登録した日だけ値を持つ', () => {
    const r = allocateDailyBudgetWithFixed(null, 10, [1, 1], [{ rooms: 5, revenue: null }, null])
    expect(r[0].rooms).toBe(5)
    expect(r[1].rooms).toBeNull()
  })
})
