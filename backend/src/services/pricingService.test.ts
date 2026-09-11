import { describe, it, expect } from 'vitest'
import { computeLandingProjection } from './pricingService.js'

// 着地シミュレーションの積み上げ計算（N-5）。DB に触れない純関数として検証する。

describe('computeLandingProjection', () => {
  const totalRooms = 100

  it('実績と予測を積み上げて着地値を算出する', () => {
    const actuals = [
      { soldRooms: 80, totalRevenue: 800_000 }, // ADR 10,000
      { soldRooms: 90, totalRevenue: 900_000 },
    ]
    const predictions = [
      { predictedOccupancy: 0.5, predictedAdr: 12_000, recommendedPrice: 9_000 },
    ]

    const result = computeLandingProjection(actuals, predictions, totalRooms, 3)

    // 実績 1,700,000 + 予測 50室 × 12,000 = 600,000
    expect(result.projectedRevenue).toBe(2_300_000)
    expect(result.projectedRooms).toBe(220)
    expect(result.projectedAdr).toBe(Math.round(2_300_000 / 220))
    expect(result.projectedOccupancy).toBe(Math.round((220 / 300) * 1000) / 1000)
    expect(result.projectedRevPar).toBe(Math.round(2_300_000 / 300))
    expect(result.actualDays).toBe(2)
    expect(result.predictedDays).toBe(1)
  })

  it('予測ADRが無い日は推奨価格で代用する', () => {
    const result = computeLandingProjection(
      [],
      [{ predictedOccupancy: 0.8, predictedAdr: null, recommendedPrice: 15_000 }],
      totalRooms,
      1
    )

    expect(result.projectedRevenue).toBe(80 * 15_000)
    expect(result.projectedRooms).toBe(80)
    expect(result.predictedDays).toBe(1)
  })

  it('予測稼働率も価格も無い日は積み上げない（0円で積むと着地ADRが下がるため）', () => {
    const result = computeLandingProjection(
      [{ soldRooms: 50, totalRevenue: 500_000 }],
      [
        { predictedOccupancy: null, predictedAdr: 12_000, recommendedPrice: 9_000 },
        { predictedOccupancy: 0.6, predictedAdr: null, recommendedPrice: null },
      ],
      totalRooms,
      3
    )

    expect(result.projectedRevenue).toBe(500_000)
    expect(result.projectedRooms).toBe(50)
    expect(result.projectedAdr).toBe(10_000)
    expect(result.predictedDays).toBe(0)
  })

  it('実績も予測も無ければ着地は0（ADR は算出不能なので null）', () => {
    const result = computeLandingProjection([], [], totalRooms, 30)

    expect(result.projectedRevenue).toBe(0)
    expect(result.projectedRooms).toBe(0)
    expect(result.projectedAdr).toBeNull()
    expect(result.projectedOccupancy).toBe(0)
    expect(result.projectedRevPar).toBe(0)
  })

  it('客室数が0でもゼロ除算しない', () => {
    const result = computeLandingProjection([{ soldRooms: 0, totalRevenue: 0 }], [], 0, 30)

    expect(result.projectedOccupancy).toBe(0)
    expect(result.projectedRevPar).toBe(0)
  })
})
