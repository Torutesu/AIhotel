import { describe, it, expect } from 'vitest'
import { evaluateHighDemand, evaluateLandingBudget } from './alertRulesService.js'

const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day))

describe('evaluateLandingBudget（#83）', () => {
  it('予算比95%以上ならアラートを出さない', () => {
    expect(
      evaluateLandingBudget({ year: 2026, month: 10, projectedRevenue: 9_500_000, budgetRevenue: 10_000_000 })
    ).toBeNull()
  })

  it('90%以上95%未満は Level 4（YELLOW）', () => {
    const alert = evaluateLandingBudget({
      year: 2026,
      month: 10,
      projectedRevenue: 9_200_000,
      budgetRevenue: 10_000_000,
    })
    expect(alert).toMatchObject({ level: 4, severity: 'YELLOW', ruleKey: 'LANDING_BELOW_BUDGET:2026-10' })
    expect(alert?.message).toContain('92.0%')
  })

  it('90%未満は Level 5（RED）', () => {
    const alert = evaluateLandingBudget({
      year: 2026,
      month: 3,
      projectedRevenue: 8_000_000,
      budgetRevenue: 10_000_000,
    })
    expect(alert).toMatchObject({ level: 5, severity: 'RED', ruleKey: 'LANDING_BELOW_BUDGET:2026-03' })
  })

  it('予算か着地予測が無い月は判定しない', () => {
    expect(evaluateLandingBudget({ year: 2026, month: 10, projectedRevenue: null, budgetRevenue: 1 })).toBeNull()
    expect(evaluateLandingBudget({ year: 2026, month: 10, projectedRevenue: 1, budgetRevenue: null })).toBeNull()
    expect(evaluateLandingBudget({ year: 2026, month: 10, projectedRevenue: 1, budgetRevenue: 0 })).toBeNull()
  })
})

describe('evaluateHighDemand（#83）', () => {
  const today = d(2026, 9, 23)

  it('14日以内の需要レベルAの日を1件にまとめ、最初の日を対象日にする', () => {
    const alert = evaluateHighDemand(
      [
        { date: d(2026, 9, 30), demandLevel: 'A' },
        { date: d(2026, 9, 26), demandLevel: 'A' },
        { date: d(2026, 9, 27), demandLevel: 'B' },
      ],
      today
    )
    expect(alert?.targetDate).toEqual(d(2026, 9, 26))
    expect(alert?.message).toContain('9/26、9/30')
    expect(alert?.title).toContain('2日')
  })

  it('14日より先や過去の日は数えない', () => {
    expect(
      evaluateHighDemand(
        [
          { date: d(2026, 9, 22), demandLevel: 'A' },
          { date: d(2026, 10, 7), demandLevel: 'A' },
        ],
        today
      )
    ).toBeNull()
  })
})
