import { describe, it, expect } from 'vitest'
import { computeDemand, type DemandModelInput } from './demandModel.js'
import { coefficientsWithDefaults, FACTOR_DEFAULTS } from './factorDefaults.js'
import { computeHolidaySignal } from '../signals/holidaySignal.js'
import type { OccupancyRecord } from './ruleBasedForecaster.js'

function d(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m - 1, day))
}

// 対象日の前4週の同曜日を 0.7 で埋めた履歴
function flatHistory(target: Date, occ: number): OccupancyRecord[] {
  const out: OccupancyRecord[] = []
  for (let w = 1; w <= 4; w++) {
    const dt = new Date(target)
    dt.setUTCDate(dt.getUTCDate() - 7 * w)
    out.push({ date: dt, occupancy: occ })
  }
  return out
}

function baseInput(target: Date, overrides: Partial<DemandModelInput> = {}): DemandModelInput {
  return {
    targetDate: target,
    leadDays: 10,
    history: flatHistory(target, 0.7),
    events: [],
    weekendDays: [5, 6],
    holiday: computeHolidaySignal(target),
    weather: null,
    pace: null,
    coefficients: coefficientsWithDefaults(),
    ...overrides,
  }
}

describe('computeDemand', () => {
  it('要因が無ければ base のみで、demandFactors の合計が予測稼働率に一致する', () => {
    const target = d(2026, 10, 7) // 水曜・祝日なし
    const r = computeDemand(baseInput(target))
    expect(r.baseOccupancy).toBeCloseTo(0.7, 6)
    expect(r.predictedOccupancy).toBeCloseTo(0.7, 6)
    const sum = r.demandFactors.reduce((s, f) => s + f.pt, 0)
    expect(sum).toBeCloseTo(r.unconstrainedOccupancy, 6)
  })

  it('祝日を含む連休前夜には holiday:eve の係数が加算される', () => {
    const target = d(2026, 9, 18) // シルバーウィーク前夜（金）
    const r = computeDemand(baseInput(target))
    const eve = r.demandFactors.find((f) => f.key === 'holiday:eve')
    expect(eve?.pt).toBeCloseTo(FACTOR_DEFAULTS['holiday:eve'], 6)
    // 金曜はホテル週末でもある（初期係数 0 なので寄与には出ないが、学習対象キーには含まれる）
    expect(r.activeFactorKeys).toContain('weekend:hotel')
    expect(r.demandFactors.some((f) => f.key === 'weekend:hotel')).toBe(false)
    expect(r.activeFactorKeys).toContain('holiday:eve')
  })

  it('雨予報は直前（3日以内）にのみ効き、8日以上先では無視する', () => {
    const target = d(2026, 10, 7)
    const rainy = { weatherCode: '300', rainProbability: 80, tempMax: null, tempMin: null, reliability: null, isRainy: true }
    const near = computeDemand(baseInput(target, { leadDays: 2, weather: rainy }))
    const far = computeDemand(baseInput(target, { leadDays: 12, weather: rainy }))
    expect(near.demandFactors.some((f) => f.key === 'weather:rain_lead0_3')).toBe(true)
    expect(far.demandFactors.some((f) => f.key.startsWith('weather:'))).toBe(false)
    expect(near.predictedOccupancy).toBeLessThan(far.predictedOccupancy)
  })

  it('学習済み係数が初期値を上書きする', () => {
    const target = d(2026, 9, 18)
    const learned = coefficientsWithDefaults([['holiday:eve', 0.2]])
    const r = computeDemand(baseInput(target, { coefficients: learned }))
    expect(r.demandFactors.find((f) => f.key === 'holiday:eve')?.pt).toBeCloseTo(0.2, 6)
  })

  it('予約ペースが基準より速ければ α で加重して上振れし、clamp前の値を保持する', () => {
    const target = d(2026, 10, 7)
    const r = computeDemand(
      baseInput(target, {
        leadDays: 2,
        pace: { roomsOnBooks: 190, daysBefore: 2, projectedOccupancy: 1.15, usedDefaultCurve: true },
      })
    )
    // α(lead0_3)=0.8 → 0.2×0.7 + 0.8×1.15 = 1.06
    expect(r.unconstrainedOccupancy).toBeCloseTo(1.06, 6)
    expect(r.predictedOccupancy).toBe(1)
    expect(r.demandFactors.find((f) => f.key === 'pace')?.pt).toBeCloseTo(0.36, 6)
  })

  it('信頼度区間はリードタイムが長いほど広い', () => {
    const target = d(2026, 10, 7)
    const near = computeDemand(baseInput(target, { leadDays: 1 }))
    const far = computeDemand(baseInput(target, { leadDays: 60 }))
    expect(far.confidence.p90 - far.confidence.p10).toBeGreaterThan(near.confidence.p90 - near.confidence.p10)
    expect(far.confidence.scalar).toBeLessThan(near.confidence.scalar)
  })
})
