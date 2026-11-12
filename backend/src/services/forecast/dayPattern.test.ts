import { describe, expect, it } from 'vitest'
import {
  clusterPickupCurves,
  completedTerms,
  contextDistance,
  kMeans,
  patternBlendWeight,
  pickupVector,
  predictFromNeighbors,
  silhouetteScore,
  type DayContext,
  type PatternHistoryDay,
} from './dayPattern.js'
import { applyPattern } from './ruleBasedForecaster.js'

// 日のパターン（D-13）: マイルストーン別のピックアップ、ピックアップ型のクラスタ、背景と入り方の近い日からの着地の予測

const DAY = 86_400_000
const d = (iso: string) => new Date(`${iso}T00:00:00Z`)
const noHoliday = { beforeDayOff: false, daysOffAhead: 0, positionInRun: 0, runLength: 0 }
const ctx = (date: Date, over: Partial<DayContext> = {}): DayContext => ({
  date,
  category: 'weekday',
  eventImpact: 0,
  holiday: noHoliday,
  seasons: [],
  weather: null,
  ...over,
})

/** マイルストーンごとの予約室数（残日数 → 室数）から予約積上を作る */
const points = (stayDate: Date, byLead: Record<number, number>) =>
  Object.entries(byLead).map(([lead, rooms]) => ({ stayDate, daysBefore: Number(lead), roomsBooked: rooms }))

describe('pickupVector', () => {
  it('マイルストーンの間に入った予約を客室数に対する割合で切り出す（最終は販売室数）', () => {
    const stay = d('2026-01-10')
    const v = pickupVector(points(stay, { 180: 10, 120: 20, 90: 30, 60: 40, 30: 50, 14: 60, 5: 70 }), 85, 100)
    expect(v).toEqual([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.15])
  })

  it('記録の無いマイルストーンを含む区間は null', () => {
    const stay = d('2026-01-10')
    const v = pickupVector(points(stay, { 90: 30, 60: 40 }), null, 100)
    expect(v.slice(0, 4)).toEqual([null, null, null, 0.1])
    expect(v[7]).toBeNull()
  })

  it('残日数 lead の時点で終わっている区間の数', () => {
    expect(completedTerms(200)).toBe(0)
    expect(completedTerms(100)).toBe(2) // 180日前時点と 179〜120日前
    expect(completedTerms(0)).toBe(8)
  })
})

describe('kMeans / clusterPickupCurves', () => {
  it('はっきり分かれた入り方は別のクラスタになり、シルエット係数が高い', () => {
    const early = Array.from({ length: 10 }, (_, i) => [0.3 + i * 0.002, 0.2, 0.1, 0.1, 0.05, 0.05, 0.02, 0.02])
    const late = Array.from({ length: 10 }, (_, i) => [0.02, 0.02, 0.03, 0.05, 0.1, 0.15, 0.2 + i * 0.002, 0.2])
    const { assignments } = kMeans([...early, ...late], 2)
    expect(new Set(assignments.slice(0, 10)).size).toBe(1)
    expect(assignments[0]).not.toBe(assignments[10])
    expect(silhouetteScore([...early, ...late], assignments)).toBeGreaterThan(0.8)
  })

  it('型の数をシルエット係数で選び、入り方の形（先行型・直前型）を付ける。欠けのある日は分けない', () => {
    const early = Array.from({ length: 8 }, (_, i) => [0.3 + i * 0.002, 0.2, 0.1, 0.1, 0.05, 0.05, 0.02, 0.02])
    const late = Array.from({ length: 8 }, (_, i) => [0.02, 0.02, 0.03, 0.05, 0.1, 0.15, 0.2 + i * 0.002, 0.2])
    const result = clusterPickupCurves([...early, ...late, [null, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]])
    expect(result.clusters).toHaveLength(2)
    expect(result.clusters.map((c) => c.shape).sort()).toEqual(['先行型', '直前型'])
    expect(result.assignments[16]).toBeNull()
    // P01 は最終の稼働が高い型
    expect(result.clusters[0].id).toBe('P01')
    expect(result.clusters[0].finalOccupancy).toBeGreaterThanOrEqual(result.clusters[1].finalOccupancy)
  })

  it('日数が足りなければ分けない', () => {
    expect(clusterPickupCurves([[0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]]).clusters).toEqual([])
  })
})

describe('contextDistance', () => {
  const base = ctx(d('2026-03-10')) // 火曜
  it('区分の違いが最も遠く、曜日・季節・休前日・イベントの違いも足す', () => {
    expect(contextDistance(base, base)).toBe(0)
    expect(contextDistance(base, { ...base, category: 'special' })).toBe(1)
    expect(contextDistance(base, ctx(new Date(d('2026-03-10').getTime() + 7 * DAY)))).toBeCloseTo(0.023, 2)
    expect(contextDistance(base, { ...base, holiday: { ...noHoliday, beforeDayOff: true, daysOffAhead: 3 } })).toBeCloseTo(0.8)
    expect(contextDistance(base, { ...base, eventImpact: 0.15 })).toBeCloseTo(0.45)
    // 天気は両方わかるときだけ比べる
    expect(contextDistance({ ...base, weather: 1 }, { ...base, weather: 3 })).toBeCloseTo(0.1)
    // 旅行シーズンの重なり
    expect(contextDistance({ ...base, seasons: ['springBreak'] }, base)).toBeCloseTo(0.4)
    expect(contextDistance({ ...base, seasons: ['springBreak', 'lunarNewYear'] }, { ...base, seasons: ['springBreak'] })).toBeCloseTo(0.2)
    expect(contextDistance({ ...base, weather: 1 }, base)).toBe(0)
  })
})

describe('predictFromNeighbors', () => {
  const totalRooms = 100
  /** 過去の平日 n 日（30日前に otb30 室・最終 final 室）。休前日は beforeDayOff */
  function history(n: number, otb30: number, final: number, over: Partial<DayContext> = {}, start = '2025-10-01'): PatternHistoryDay[] {
    return Array.from({ length: n }, (_, i) => {
      const date = new Date(d(start).getTime() + i * 7 * DAY)
      const pts = points(date, { 30: otb30, 14: Math.round((otb30 + final) / 2), 5: final - 2 })
      return {
        context: ctx(date, over),
        points: pts,
        finalRooms: final,
        adr: final > 80 ? 20000 : 14000,
        pickup: pickupVector(pts, final, totalRooms),
        paceCluster: final > 80 ? 'P01' : 'P02',
      }
    })
  }

  it('過去の日が足りなければ null', () => {
    expect(predictFromNeighbors({ context: ctx(d('2026-12-01')), lead: 30, otbRooms: 40, points: [], totalRooms }, history(5, 40, 70))).toBeNull()
  })

  it('今の予約に、近傍の「今から当日まで」のピックアップを足して着地を出す', () => {
    // 平日（30日前 40室 → 最終 70室）が 25日、休前日（30日前 60室 → 最終 95室）が 25日
    const past = [...history(25, 40, 70), ...history(25, 60, 95, { holiday: { ...noHoliday, beforeDayOff: true, daysOffAhead: 2 } }, '2025-10-02')]
    const stay = d('2026-12-01')
    const weekday = predictFromNeighbors(
      { context: ctx(stay), lead: 30, otbRooms: 45, points: points(stay, { 30: 45 }), totalRooms },
      past
    )
    expect(weekday?.pickupRooms).toBeCloseTo(30, 0)
    expect(weekday?.occupancy).toBeCloseTo(0.75, 2) // 45 + 30
    expect(weekday?.adr).toBe(14000)
    expect(weekday?.paceCluster).toBe('P02')

    const eve = predictFromNeighbors(
      {
        context: ctx(stay, { holiday: { ...noHoliday, beforeDayOff: true, daysOffAhead: 2 } }),
        lead: 30,
        otbRooms: 55,
        points: points(stay, { 30: 55 }),
        totalRooms,
      },
      past
    )
    expect(eve?.occupancy).toBeCloseTo(0.9, 2) // 55 + 35
    expect(eve?.adr).toBe(20000)
    expect(eve?.spread).toBeLessThan(0.05)
  })

  it('今の予約が無い日は近傍の着地そのもの', () => {
    const past = history(25, 40, 70)
    const p = predictFromNeighbors({ context: ctx(d('2026-12-01')), lead: 200, otbRooms: null, points: [], totalRooms }, past)
    expect(p?.occupancy).toBeCloseTo(0.7, 2)
    expect(p?.pickupRooms).toBeNull()
  })
})

describe('patternBlendWeight / applyPattern', () => {
  it('90日以内で強く、散らばりが大きいと弱める', () => {
    expect(patternBlendWeight(30, 0.05)).toBe(0.7)
    expect(patternBlendWeight(120, 0.05)).toBe(0.5)
    expect(patternBlendWeight(300, 0.05)).toBe(0.3)
    expect(patternBlendWeight(30, 0.35)).toBe(0.35)
  })

  it('近傍の着地を混ぜ、予約済みを下限にし、近傍に無いイベントの補正を足す', () => {
    const prediction = {
      occupancy: 0.8,
      adr: 18000,
      neighbors: 12,
      spread: 0.05,
      pickupRooms: 30,
      paceCluster: 'P01',
      eventShare: 0,
      similarDates: [],
    }
    const r = applyPattern(0.6, { prediction, leadDays: 30 }, 0, undefined)
    expect(r.predicted).toBeCloseTo(0.74) // 0.6 × 0.3 + 0.8 × 0.7
    expect(r.impact).toBeCloseTo(0.14)
    const withEvent = applyPattern(0.6, { prediction, leadDays: 30 }, 0.08, undefined)
    expect(withEvent.patternOccupancy).toBeCloseTo(0.88)
    const floored = applyPattern(0.3, { prediction: { ...prediction, occupancy: 0.4 }, leadDays: 30 }, 0, {
      leadDays: 30,
      otbRooms: 60,
      lastYearOtbRooms: null,
      lastYearFinalRooms: null,
      totalRooms: 100,
    })
    expect(floored.predicted).toBe(0.6)
  })
})
