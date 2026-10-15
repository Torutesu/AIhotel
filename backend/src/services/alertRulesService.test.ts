import { describe, it, expect } from 'vitest'
import { evaluateHighDemand, evaluateLandingBudget, evaluateRecommendationAnomalies } from './alertRulesService.js'

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

describe('evaluateRecommendationAnomalies（推奨価格の異常 — D-11）', () => {
  const today = new Date('2026-10-15T00:00:00.000Z')
  const day = (offset: number, predictedAdr: number | null, lastYearAdr: number | null) => ({
    date: new Date(today.getTime() + offset * 86_400_000),
    predictedAdr,
    lastYearAdr,
  })

  it('外れた日が無ければ作らない', () => {
    expect(evaluateRecommendationAnomalies([day(1, 12000, 11000), day(40, null, 10000)], today)).toBeNull()
  })

  it('直近に高すぎる日があれば Level 4 で、予算の進捗と価格の幅の上限を案内する', () => {
    const alert = evaluateRecommendationAnomalies(
      [day(5, 20000, 10000), day(60, 18000, 10000), day(70, 5000, 10000)],
      today,
      new Map([['2026-10', 0.93]])
    )
    expect(alert).toMatchObject({ ruleKey: 'RECOMMENDATION_ANOMALY', level: 4, severity: 'YELLOW' })
    expect(alert!.title).toContain('3日')
    expect(alert!.message).toContain('10/20（200%）')
    expect(alert!.message).toContain('予算の93.0%')
    expect(alert!.message).toContain('先々で高い日: 12/14（180%）')
    expect(alert!.message).toContain('大幅に安い日: 12/24（50%）')
    expect(alert!.targetDate?.toISOString().slice(0, 10)).toBe('2026-10-20')
  })

  it('先々だけなら Level 3（様子見）', () => {
    const alert = evaluateRecommendationAnomalies([day(45, 16000, 10000)], today)
    expect(alert).toMatchObject({ level: 3 })
    expect(alert!.message).toContain('様子見')
  })
})
