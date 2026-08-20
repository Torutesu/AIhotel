import { describe, it, expect } from 'vitest'
import {
  deriveForecastMetrics,
  computeForecastVariance,
  evaluateThreshold,
  compareAccuracy,
  aggregateMetrics,
  analyzeByReason,
  DEFAULT_THRESHOLDS,
  type ForecastMetrics,
  type ReasonSample,
} from './metrics.js'

const TOTAL_ROOMS = 200

describe('deriveForecastMetrics', () => {
  it('稼働率とADRから販売室数・売上を導出する', () => {
    const result = deriveForecastMetrics({ occupancy: 0.8, adr: 18_000 }, TOTAL_ROOMS)
    expect(result.soldRooms).toBe(160)
    expect(result.revenue).toBe(2_880_000)
  })

  it('販売室数と売上から稼働率とADRを導出する（室数ベースで考える担当者向け）', () => {
    const result = deriveForecastMetrics({ soldRooms: 150, revenue: 2_700_000 }, TOTAL_ROOMS)
    expect(result.occupancy).toBe(0.75)
    expect(result.adr).toBe(18_000)
  })

  it('入力された値は導出値で上書きしない', () => {
    // 稼働率0.8なら室数160だが、担当者が155と明示したらそちらを残す
    const result = deriveForecastMetrics({ occupancy: 0.8, adr: 18_000, soldRooms: 155 }, TOTAL_ROOMS)
    expect(result.soldRooms).toBe(155)
    expect(result.revenue).toBe(155 * 18_000)
  })

  it('材料が無い指標は null のままにする', () => {
    const result = deriveForecastMetrics({ occupancy: 0.8 }, TOTAL_ROOMS)
    expect(result.soldRooms).toBe(160)
    expect(result.adr).toBeNull()
    expect(result.revenue).toBeNull()
  })

  it('総室数が0でもゼロ除算しない', () => {
    const result = deriveForecastMetrics({ soldRooms: 10, revenue: 100_000 }, 0)
    expect(result.occupancy).toBeNull()
    expect(result.adr).toBe(10_000)
  })
})

describe('computeForecastVariance', () => {
  const ai: ForecastMetrics = { occupancy: 0.7, adr: 18_000, soldRooms: 140, revenue: 2_520_000 }

  it('担当者が強気ならプラス、弱気ならマイナスになる', () => {
    const bullish = computeForecastVariance(ai, {
      occupancy: 0.78,
      adr: 19_800,
      soldRooms: 156,
      revenue: 3_088_800,
    })
    expect(bullish.occupancyDelta).toBe(0.08)
    expect(bullish.adrDelta).toBe(1_800)
    expect(bullish.adrDeltaPct).toBe(0.1)
    expect(bullish.soldRoomsDelta).toBe(16)
    expect(bullish.revenueDeltaPct).toBeCloseTo(0.2257, 3)

    const bearish = computeForecastVariance(ai, {
      occupancy: 0.62,
      adr: 17_100,
      soldRooms: 124,
      revenue: 2_120_400,
    })
    expect(bearish.occupancyDelta).toBe(-0.08)
    expect(bearish.adrDeltaPct).toBe(-0.05)
  })

  it('片方が欠けている指標は算出しない', () => {
    const variance = computeForecastVariance(ai, {
      occupancy: 0.75,
      adr: null,
      soldRooms: 150,
      revenue: null,
    })
    expect(variance.occupancyDelta).toBe(0.05)
    expect(variance.adrDelta).toBeNull()
    expect(variance.revenueDeltaPct).toBeNull()
  })
})

describe('evaluateThreshold', () => {
  it('どの指標が基準を超えたかを返す', () => {
    const result = evaluateThreshold(
      {
        occupancyDelta: 0.06,
        adrDelta: 200,
        adrDeltaPct: 0.011,
        soldRoomsDelta: 12,
        revenueDelta: 200_000,
        revenueDeltaPct: 0.08,
      },
      DEFAULT_THRESHOLDS
    )
    expect(result.exceeded).toBe(true)
    expect(result.breached).toEqual(['occupancy'])
  })

  it('すべて基準内なら超過なし', () => {
    const result = evaluateThreshold(
      {
        occupancyDelta: 0.02,
        adrDelta: 300,
        adrDeltaPct: 0.017,
        soldRoomsDelta: 4,
        revenueDelta: 90_000,
        revenueDeltaPct: 0.04,
      },
      DEFAULT_THRESHOLDS
    )
    expect(result.exceeded).toBe(false)
    expect(result.breached).toEqual([])
  })

  it('閾値ちょうどは超過として扱う', () => {
    const result = evaluateThreshold(
      {
        occupancyDelta: 0.05,
        adrDelta: null,
        adrDeltaPct: null,
        soldRoomsDelta: null,
        revenueDelta: null,
        revenueDeltaPct: null,
      },
      DEFAULT_THRESHOLDS
    )
    expect(result.exceeded).toBe(true)
  })

  it('ホテル別に閾値を緩められる', () => {
    const variance = {
      occupancyDelta: 0.06,
      adrDelta: null,
      adrDeltaPct: null,
      soldRoomsDelta: null,
      revenueDelta: null,
      revenueDeltaPct: null,
    }
    expect(
      evaluateThreshold(variance, { ...DEFAULT_THRESHOLDS, occupancyPtThreshold: 0.1 }).exceeded
    ).toBe(false)
  })
})

describe('compareAccuracy', () => {
  const ai: ForecastMetrics = { occupancy: 0.7, adr: 18_000, soldRooms: 140, revenue: 2_520_000 }
  const operator: ForecastMetrics = { occupancy: 0.8, adr: 19_000, soldRooms: 160, revenue: 3_040_000 }

  it('実績に近い方を指標ごとに判定する', () => {
    const actual: ForecastMetrics = { occupancy: 0.79, adr: 18_200, soldRooms: 158, revenue: 2_875_600 }
    const result = compareAccuracy(ai, operator, actual)
    expect(result.occupancy).toBe('OPERATOR')
    expect(result.adr).toBe('AI')
    // 売上は 2,875,600 → AI 2,520,000（誤差355,600） vs 担当者 3,040,000（誤差164,400）
    expect(result.revenue).toBe('OPERATOR')
    expect(result.overall).toBe('OPERATOR')
  })

  it('誤差が同じなら引き分け', () => {
    const actual: ForecastMetrics = { occupancy: 0.75, adr: null, soldRooms: null, revenue: null }
    expect(compareAccuracy(ai, operator, actual).occupancy).toBe('TIE')
  })

  it('実績が無ければ評価しない（将来日）', () => {
    const actual: ForecastMetrics = { occupancy: null, adr: null, soldRooms: null, revenue: null }
    const result = compareAccuracy(ai, operator, actual)
    expect(result.occupancy).toBeNull()
    expect(result.overall).toBeNull()
  })

  it('総合は売上で判定し、売上が無ければ稼働率で判定する', () => {
    const actual: ForecastMetrics = { occupancy: 0.71, adr: null, soldRooms: null, revenue: null }
    expect(compareAccuracy(ai, operator, actual).overall).toBe('AI')
  })
})

describe('aggregateMetrics', () => {
  it('稼働率は日平均ではなく販売室数の合計から出す', () => {
    // 1日目: 200室中180室、2日目: 200室中20室 → 合計200室 / (200室 × 2日) = 50%
    const totals = aggregateMetrics(
      [
        { occupancy: 0.9, adr: 20_000, soldRooms: 180, revenue: 3_600_000 },
        { occupancy: 0.1, adr: 10_000, soldRooms: 20, revenue: 200_000 },
      ],
      200
    )
    expect(totals.soldRooms).toBe(200)
    expect(totals.occupancy).toBe(0.5)
    // ADRも売上合計 ÷ 室数合計。日平均(15,000)にはならない
    expect(totals.adr).toBe(19_000)
    expect(totals.revenue).toBe(3_800_000)
    expect(totals.days).toBe(2)
  })

  it('データが無ければ null（0で埋めない）', () => {
    const totals = aggregateMetrics([{ occupancy: null, adr: null, soldRooms: null, revenue: null }], 200)
    expect(totals.days).toBe(0)
    expect(totals.occupancy).toBeNull()
    expect(totals.revenue).toBeNull()
  })
})

describe('analyzeByReason', () => {
  function sample(reason: ReasonSample['reason'], occupancyDelta: number, overall: 'AI' | 'OPERATOR' | null): ReasonSample {
    return {
      reason,
      variance: {
        occupancyDelta,
        adrDelta: null,
        adrDeltaPct: 0.05,
        soldRoomsDelta: null,
        revenueDelta: null,
        revenueDeltaPct: 0.1,
      },
      accuracy: { occupancy: overall, adr: null, revenue: null, overall },
    }
  }

  it('背景ごとに件数・平均乖離・的中率を出し、件数の多い順に並べる', () => {
    const result = analyzeByReason([
      sample('GROUP_CONTRACT', 0.1, 'OPERATOR'),
      sample('GROUP_CONTRACT', 0.08, 'OPERATOR'),
      sample('GROUP_CONTRACT', 0.06, 'AI'),
      sample('MARKET_TREND', -0.05, 'AI'),
    ])

    expect(result.map((r) => r.key)).toEqual(['GROUP_CONTRACT', 'MARKET_TREND'])
    expect(result[0].count).toBe(3)
    expect(result[0].avgOccupancyDelta).toBe(0.08)
    expect(result[0].operatorCloserRate).toBeCloseTo(0.6667, 3)
    expect(result[0].evaluatedCount).toBe(3)
    expect(result[1].operatorCloserRate).toBe(0)
  })

  it('実績が無い背景は的中率を出さない（母数0）', () => {
    const result = analyzeByReason([sample('BOOKING_PACE', 0.07, null)])
    expect(result[0].operatorCloserRate).toBeNull()
    expect(result[0].evaluatedCount).toBe(0)
  })
})
