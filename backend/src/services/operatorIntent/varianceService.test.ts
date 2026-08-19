import { describe, it, expect } from 'vitest'
import {
  computeVarianceDay,
  summarizeVariance,
  dayTypeOf,
  segmentKeyOf,
  type VarianceDayInput,
} from './varianceService.js'

function baseDay(overrides: Partial<VarianceDayInput> = {}): VarianceDayInput {
  return {
    date: '2026-08-01',
    dayType: 'weekday',
    demandLevel: 'C',
    aiRank: 20,
    aiPrice: 18_000,
    aiPredictedOccupancy: 0.7,
    aiPredictedAdr: 18_000,
    appliedRank: 20,
    appliedPrice: 18_000,
    decisionType: 'ACCEPTED',
    intentReason: 'FOLLOW_AI',
    intentNote: null,
    decidedByName: 'フロント担当',
    decidedAt: '2026-07-20T00:00:00.000Z',
    decisionCount: 1,
    actualOccupancy: null,
    actualAdr: null,
    actualRevPar: null,
    ...overrides,
  }
}

describe('dayTypeOf', () => {
  it('Hotel.weekendDays に含まれる曜日を weekend として扱う（週末定義をハードコードしない）', () => {
    // 2026-08-01 は土曜日(6)、2026-08-03 は月曜日(1)
    expect(dayTypeOf(new Date(Date.UTC(2026, 7, 1)), [5, 6])).toBe('weekend')
    expect(dayTypeOf(new Date(Date.UTC(2026, 7, 3)), [5, 6])).toBe('weekday')
    // 日・月を週末とするホテルでは結果が入れ替わる
    expect(dayTypeOf(new Date(Date.UTC(2026, 7, 3)), [0, 1])).toBe('weekend')
  })
})

describe('segmentKeyOf', () => {
  it('需要レベルが不明なら UNKNOWN セグメントにまとめる', () => {
    expect(segmentKeyOf('A', 'weekend')).toBe('A:weekend')
    expect(segmentKeyOf(null, 'weekday')).toBe('UNKNOWN:weekday')
  })
})

describe('computeVarianceDay', () => {
  it('AI推奨より上げた場合、ランク差・価格差・乖離率がプラスになる', () => {
    const result = computeVarianceDay(
      baseDay({ appliedRank: 23, appliedPrice: 19_800, decisionType: 'RAISED', intentReason: 'EVENT_DEMAND' })
    )
    expect(result.rankDelta).toBe(3)
    expect(result.priceDelta).toBe(1_800)
    expect(result.priceDeltaPct).toBe(0.1)
  })

  it('AI推奨より下げた場合はマイナスになる', () => {
    const result = computeVarianceDay(
      baseDay({ appliedRank: 17, appliedPrice: 16_200, decisionType: 'LOWERED' })
    )
    expect(result.rankDelta).toBe(-3)
    expect(result.priceDelta).toBe(-1_800)
    expect(result.priceDeltaPct).toBe(-0.1)
  })

  it('実績があれば予測との差と想定RevPARを算出する', () => {
    const result = computeVarianceDay(
      baseDay({ actualOccupancy: 0.78, actualAdr: 19_000, actualRevPar: 14_820 })
    )
    // 想定RevPAR = 予測稼働率 0.7 × 予測ADR 18,000 = 12,600
    expect(result.estimatedAiRevPar).toBe(12_600)
    expect(result.occupancyDelta).toBe(0.08)
    expect(result.adrDelta).toBe(1_000)
    expect(result.revParDelta).toBe(2_220)
    expect(result.outcome).toBe('OPERATOR_BETTER')
  })

  it('想定RevPARを下回れば AI_BETTER、許容誤差内なら EVEN と判定する', () => {
    const worse = computeVarianceDay(baseDay({ actualRevPar: 11_000 }))
    expect(worse.outcome).toBe('AI_BETTER')

    // 12,600 に対し +1% は許容誤差(2%)内
    const even = computeVarianceDay(baseDay({ actualRevPar: 12_726 }))
    expect(even.outcome).toBe('EVEN')
  })

  it('想定RevPARの基準は推奨価格ではなく予測ADRを使う', () => {
    // 推奨価格(定価) 25,000 とブレンドADRを比べると常に定価側が高く出るため基準にしない
    const result = computeVarianceDay(
      baseDay({ aiPrice: 25_000, aiPredictedAdr: 18_000, actualRevPar: 13_000 })
    )
    expect(result.estimatedAiRevPar).toBe(12_600)
    expect(result.outcome).toBe('OPERATOR_BETTER')
  })

  it('予測ADRが無い場合のみAI推奨価格を基準にする', () => {
    const result = computeVarianceDay(
      baseDay({ aiPredictedAdr: null, aiPrice: 18_000, actualRevPar: 13_000 })
    )
    expect(result.estimatedAiRevPar).toBe(12_600)
  })

  it('実績が無い将来日は outcome を判定しない（null のまま）', () => {
    expect(computeVarianceDay(baseDay()).outcome).toBeNull()
  })

  it('意向が記録されていない日はランク差・価格差を算出しない', () => {
    const result = computeVarianceDay(
      baseDay({ appliedRank: null, appliedPrice: null, decisionType: null, intentReason: null })
    )
    expect(result.rankDelta).toBeNull()
    expect(result.priceDelta).toBeNull()
    expect(result.priceDeltaPct).toBeNull()
  })
})

describe('summarizeVariance', () => {
  const days = [
    computeVarianceDay(baseDay({ date: '2026-08-01' })), // ACCEPTED
    computeVarianceDay(
      baseDay({
        date: '2026-08-02',
        dayType: 'weekend',
        demandLevel: 'A',
        appliedRank: 24,
        appliedPrice: 19_800,
        decisionType: 'RAISED',
        intentReason: 'EVENT_DEMAND',
        actualRevPar: 14_000, // 想定 12,600 を上回る
      })
    ),
    computeVarianceDay(
      baseDay({
        date: '2026-08-03',
        appliedRank: 16,
        appliedPrice: 16_200,
        decisionType: 'LOWERED',
        intentReason: 'COMPETITOR_MOVE',
        actualRevPar: 11_000, // 想定 12,600 を下回る
      })
    ),
    // 意向未記録の日
    computeVarianceDay(
      baseDay({ date: '2026-08-04', appliedRank: null, appliedPrice: null, decisionType: null, intentReason: null })
    ),
  ]

  it('意向が記録された日だけを判断件数の母数にする', () => {
    const summary = summarizeVariance(days)
    expect(summary.totalDays).toBe(4)
    expect(summary.decidedDays).toBe(3)
    expect(summary.acceptedCount).toBe(1)
    expect(summary.raisedCount).toBe(1)
    expect(summary.loweredCount).toBe(1)
    expect(summary.followRate).toBeCloseTo(1 / 3, 4)
  })

  it('実績が判明した判断だけで運営判断の勝率を出す', () => {
    const summary = summarizeVariance(days)
    expect(summary.evaluatedCount).toBe(2)
    expect(summary.outperformRate).toBe(0.5)
  })

  it('意向理由別とセグメント別に内訳を返す', () => {
    const summary = summarizeVariance(days)
    const event = summary.byIntentReason.find((b) => b.key === 'EVENT_DEMAND')
    expect(event?.count).toBe(1)
    expect(event?.avgRankDelta).toBe(4)
    expect(event?.label).toBe('イベント・地域需要')

    const weekendA = summary.bySegment.find((b) => b.key === 'A:weekend')
    expect(weekendA?.count).toBe(1)
  })

  it('判断が1件も無ければ割合系は null を返す（0除算しない）', () => {
    const summary = summarizeVariance([
      computeVarianceDay(
        baseDay({ appliedRank: null, appliedPrice: null, decisionType: null, intentReason: null })
      ),
    ])
    expect(summary.followRate).toBeNull()
    expect(summary.outperformRate).toBeNull()
    expect(summary.byIntentReason).toEqual([])
  })
})
