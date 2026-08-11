import { describe, it, expect } from 'vitest'
import {
  FEATURE_NAMES,
  FEATURE_COUNT,
  buildFeatureVector,
  seasonCycle,
  splitByTime,
  diffDays,
  clamp01,
  type FeatureContext,
  type TrainingSample,
} from './features.js'

// 需要予測の特徴量（4E-1 — docs/ai-agent-design.md §1）

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

const baseContext: FeatureContext = {
  stayDate: d('2026-08-15'), // 土曜
  predictedAt: d('2026-08-01'),
  weekendDays: [5, 6],
  isHoliday: false,
  isTokujitsu: false,
  isDayBeforeSpecial: false,
  isDayAfterSpecial: false,
  onHandOccupancy: 0.6,
  onHandLastYearSameLead: 0.5,
  pickup7d: 0.1,
  remainingRatio: 0.4,
  sameWeekdayMa28: 0.7,
  yearOverYearOccupancy: 0.65,
  trailing7dOccupancy: 0.72,
  externalImpactSum: 0.3,
  externalFactorCount: 2,
}

/** 名前で特徴量を引く（並び順の前提をテスト側に持ち込まないため） */
function featureOf(ctx: FeatureContext, name: (typeof FEATURE_NAMES)[number]): number {
  return buildFeatureVector(ctx)[FEATURE_NAMES.indexOf(name)]
}

describe('buildFeatureVector', () => {
  it('定義と同じ数・同じ並びのベクトルを返す', () => {
    const vector = buildFeatureVector(baseContext)
    expect(vector).toHaveLength(FEATURE_COUNT)
    expect(FEATURE_NAMES).toHaveLength(FEATURE_COUNT)
    expect(vector.every((v) => Number.isFinite(v))).toBe(true)
  })

  it('曜日をone-hotにする', () => {
    // 2026-08-15 は土曜
    expect(featureOf(baseContext, 'dow_sat')).toBe(1)
    expect(featureOf(baseContext, 'dow_fri')).toBe(0)
  })

  it('週末判定はホテル設定の weekendDays に従う（金土をハードコードしない）', () => {
    const friday = { ...baseContext, stayDate: d('2026-08-14') }
    expect(featureOf(friday, 'is_weekend')).toBe(1)
    // 日月を週末とするホテルでは金曜は週末でない
    expect(featureOf({ ...friday, weekendDays: [0, 1] }, 'is_weekend')).toBe(0)
  })

  it('リードタイムを正規化する（180日で1.0）', () => {
    expect(featureOf(baseContext, 'lead_time_norm')).toBeCloseTo(14 / 180, 6)
    const far = { ...baseContext, predictedAt: d('2026-01-01') }
    expect(featureOf(far, 'lead_time_norm')).toBe(1)
  })

  it('予測日が宿泊日より後でもリードタイムは負にならない', () => {
    const past = { ...baseContext, predictedAt: d('2026-08-20') }
    expect(featureOf(past, 'lead_time_norm')).toBe(0)
  })

  it('オンハンドの前年比を出す。前年が0や欠損なら中立の1.0', () => {
    expect(featureOf(baseContext, 'on_hand_vs_last_year')).toBeCloseTo(0.6 / 0.5, 6)
    expect(featureOf({ ...baseContext, onHandLastYearSameLead: 0 }, 'on_hand_vs_last_year')).toBe(1)
    expect(
      featureOf({ ...baseContext, onHandLastYearSameLead: null }, 'on_hand_vs_last_year')
    ).toBe(1)
  })

  it('稼働率系の欠損は0ではなく中央値相当（0.5）で埋める', () => {
    // 0埋めすると「データが無い」を「稼働率0%」と誤って学習してしまう
    const missing = { ...baseContext, onHandOccupancy: null, sameWeekdayMa28: null }
    expect(featureOf(missing, 'on_hand_occupancy')).toBe(0.5)
    expect(featureOf(missing, 'same_weekday_ma28')).toBe(0.5)
  })

  it('pickupの欠損は0で埋める（動きが無かったのと同義のため）', () => {
    expect(featureOf({ ...baseContext, pickup7d: null }, 'pickup_7d')).toBe(0)
  })

  it('特日と、その前後日をそれぞれ別の特徴量にする', () => {
    const ctx = { ...baseContext, isTokujitsu: true, isDayBeforeSpecial: true }
    expect(featureOf(ctx, 'is_tokujitsu')).toBe(1)
    expect(featureOf(ctx, 'is_holiday')).toBe(0)
    expect(featureOf(ctx, 'is_day_before_special')).toBe(1)
  })

  it('異常な外部要因スコアは丸める（学習を壊さないため）', () => {
    expect(featureOf({ ...baseContext, externalImpactSum: 99 }, 'external_impact_sum')).toBe(3)
    expect(featureOf({ ...baseContext, externalImpactSum: -99 }, 'external_impact_sum')).toBe(-3)
  })
})

describe('seasonCycle', () => {
  it('12月31日と1月1日を近い値にする（年またぎで不連続にしない）', () => {
    const dec31 = seasonCycle(d('2025-12-31'))
    const jan01 = seasonCycle(d('2026-01-01'))
    const distance = Math.hypot(dec31.sin - jan01.sin, dec31.cos - jan01.cos)
    expect(distance).toBeLessThan(0.05)
  })

  it('半年離れた日は円周上で反対側になる', () => {
    const jan = seasonCycle(d('2026-01-01'))
    const jul = seasonCycle(d('2026-07-02'))
    expect(jan.cos).toBeCloseTo(-jul.cos, 1)
  })
})

describe('splitByTime', () => {
  const sample = (iso: string): TrainingSample => ({
    features: [],
    target: 0.5,
    stayDate: d(iso),
  })

  it('時間で切る（ランダム分割しない）', () => {
    const samples = ['2026-01-05', '2026-01-01', '2026-01-10', '2026-01-03', '2026-01-08'].map(
      sample
    )
    const { train, validation } = splitByTime(samples, 0.4)
    // 検証側はすべて学習側より新しい
    const newestTrain = Math.max(...train.map((s) => s.stayDate.getTime()))
    const oldestValidation = Math.min(...validation.map((s) => s.stayDate.getTime()))
    expect(oldestValidation).toBeGreaterThan(newestTrain)
  })

  it('件数が少なくても検証を空にしない（誤差0で最良と誤判定しないため）', () => {
    const { train, validation } = splitByTime([sample('2026-01-01'), sample('2026-01-02')], 0.2)
    expect(validation.length).toBeGreaterThanOrEqual(1)
    expect(train.length + validation.length).toBe(2)
  })
})

describe('diffDays / clamp01', () => {
  it('時刻成分を無視して日数差を出す', () => {
    expect(diffDays(new Date('2026-08-01T23:00:00Z'), new Date('2026-08-03T01:00:00Z'))).toBe(2)
  })

  it('範囲外・非数値を安全な値に丸める', () => {
    expect(clamp01(1.5)).toBe(1)
    expect(clamp01(-0.2)).toBe(0)
    expect(clamp01(Number.NaN)).toBe(0.5)
  })
})
