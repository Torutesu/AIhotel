import { describe, it, expect } from 'vitest'
import { demandLevelOf, computeConfidence } from './learnedForecaster.js'
import { buildTrainingSamples, TRAINING_LEAD_TIMES } from './trainingService.js'
import { FEATURE_COUNT } from './features.js'
import type { FeatureSourceData } from './featureContextService.js'

// 学習済みモデルによる需要予測（4E-2 — docs/ai-agent-design.md §2, §3, §4）

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

/** 最小限の材料。実DBを使わずに学習サンプル生成を検証する */
function makeSourceData(overrides: Partial<FeatureSourceData> = {}): FeatureSourceData {
  return {
    hotelId: 'demo-hotel-001',
    totalRooms: 100,
    weekendDays: [5, 6],
    actualOccupancyByDate: new Map([
      ['2026-08-01', 0.8],
      ['2026-08-02', 0.9],
    ]),
    onHandByStayAndCaptured: new Map(),
    specialDayKinds: new Map(),
    externalFactorsByDate: new Map(),
    remainingRatioByStayAndCaptured: new Map(),
    ...overrides,
  }
}

describe('demandLevelOf', () => {
  it('稼働率を需要レベルA〜Eに写す（UI表示名は「アラート」）', () => {
    expect(demandLevelOf(0.95)).toBe('A')
    expect(demandLevelOf(0.85)).toBe('B')
    expect(demandLevelOf(0.7)).toBe('C')
    expect(demandLevelOf(0.55)).toBe('D')
    expect(demandLevelOf(0.2)).toBe('E')
  })

  it('境界値は上のレベルに含める', () => {
    expect(demandLevelOf(0.9)).toBe('A')
    expect(demandLevelOf(0.8)).toBe('B')
  })
})

describe('computeConfidence', () => {
  it('予測が遠いほど確信度が下がる', () => {
    const near = computeConfidence({ leadTimeDays: 3, validationMae: 0.03 })
    const far = computeConfidence({ leadTimeDays: 180, validationMae: 0.03 })
    expect(near).toBeGreaterThan(far)
  })

  it('モデルの検証誤差が大きいほど確信度が下がる', () => {
    const good = computeConfidence({ leadTimeDays: 7, validationMae: 0.02 })
    const bad = computeConfidence({ leadTimeDays: 7, validationMae: 0.15 })
    expect(good).toBeGreaterThan(bad)
  })

  it('誤差が目標を大きく超えるモデルでは確信度がほぼ0になる（自動書き込みさせない）', () => {
    expect(computeConfidence({ leadTimeDays: 7, validationMae: 0.25 })).toBeLessThan(0.05)
  })

  it('0〜1の範囲に収まる', () => {
    for (const leadTime of [0, 30, 180, 365]) {
      for (const mae of [0, 0.05, 0.5]) {
        const value = computeConfidence({ leadTimeDays: leadTime, validationMae: mae })
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('buildTrainingSamples', () => {
  it('1つの宿泊日を複数のリードタイムに展開する（サンプル数を確保するため）', () => {
    const samples = buildTrainingSamples(makeSourceData(), [d('2026-08-01')])
    expect(samples).toHaveLength(TRAINING_LEAD_TIMES.length)
    // 同じ宿泊日なので教師値は共通
    expect(new Set(samples.map((s) => s.target))).toEqual(new Set([0.8]))
  })

  it('リードタイムが違えば特徴量も変わる（予測地平を学習できる）', () => {
    const samples = buildTrainingSamples(makeSourceData(), [d('2026-08-01')], [7, 90])
    expect(samples[0].features).not.toEqual(samples[1].features)
    expect(samples[0].features).toHaveLength(FEATURE_COUNT)
  })

  it('実績が無い宿泊日はサンプルにしない（教師値が作れないため）', () => {
    // 2026-08-05 は actualOccupancyByDate に無い
    expect(buildTrainingSamples(makeSourceData(), [d('2026-08-05')])).toHaveLength(0)
  })

  it('複数の宿泊日をまとめて展開する', () => {
    const samples = buildTrainingSamples(
      makeSourceData(),
      [d('2026-08-01'), d('2026-08-02')],
      [7, 30]
    )
    expect(samples).toHaveLength(4)
    expect(samples.filter((s) => s.target === 0.9)).toHaveLength(2)
  })
})
