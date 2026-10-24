import { describe, it, expect } from 'vitest'
import { computeLandingProjection, roomTypeMixFrom, toRoomTypeDay } from './pricingService.js'

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

// 日別価格カレンダーのタイプ切り替え（2026-10-24 の画面修正）
describe('roomTypeMixFrom', () => {
  it('過去の販売室数の比と、ADR の比（このタイプ ÷ 全タイプ）を出す', () => {
    const totals = [
      { roomTypeId: 'a', soldRooms: 40, revenue: 440_000 }, // ADR 11,000
      { roomTypeId: 'b', soldRooms: 20, revenue: 280_000 }, // ADR 14,000
    ]
    expect(roomTypeMixFrom(totals, 'b', 0.4)).toEqual({ roomShare: 20 / 60, adrRatio: 14_000 / 12_000 })
  })

  it('実績が無ければ客室数の比・単価は同じとみなし、売れていないタイプは 0 にする', () => {
    expect(roomTypeMixFrom([], 'b', 0.4)).toEqual({ roomShare: 0.4, adrRatio: 1 })
    expect(roomTypeMixFrom([{ roomTypeId: 'a', soldRooms: 10, revenue: 100_000 }], 'b', 0.4)).toEqual({ roomShare: 0, adrRatio: 1 })
  })
})

describe('toRoomTypeDay', () => {
  const day = {
    date: '2026-11-15',
    predictedOccupancy: 0.7,
    predictedAdr: 11_000,
    recommendedPrice: 12_000,
    recommendedRank: 20,
    budgetRooms: 50,
    budgetOccupancy: 0.5,
    budgetAdr: 10_000,
    budgetRevenue: 500_000,
    onHandRooms: 36,
    currentOccupancy: 0.36,
    actualOccupancy: null,
    actualAdr: null,
    onHandAdr: null,
    currentRevenue: null,
    expectedRevenue: 770_000,
  }
  const mix = { roomShare: 1 / 3, adrRatio: 14_000 / 12_000 }

  it('予算は持たない（null）。先の日の現在値は無く、AI の想定値は販売構成と単価の比で配る。料金ランクはそのまま', () => {
    const result = toRoomTypeDay(day, { count: 40, hotelRooms: 100, mix, actual: null })
    expect(result).toMatchObject({
      budgetRooms: null,
      budgetOccupancy: null,
      budgetAdr: null,
      budgetRevenue: null,
      onHandRooms: null,
      currentOccupancy: null,
      currentRevenue: null,
      predictedOccupancy: 0.575, // 70室 × 1/3 = 23室 ÷ 40室
      predictedAdr: 12_833,
      expectedRevenue: Math.round(23 * 11_000 * (14_000 / 12_000)),
      recommendedRank: 20,
      recommendedPrice: 12_000,
    })
  })

  it('結果の出た日はタイプ別の実績（販売室数・売上）から稼働率・ADR を出す', () => {
    const result = toRoomTypeDay(day, { count: 40, hotelRooms: 100, mix, actual: { soldRooms: 20, revenue: 280_000 } })
    expect(result).toMatchObject({
      onHandRooms: 20,
      currentOccupancy: 0.5,
      actualOccupancy: 0.5,
      onHandAdr: 14_000,
      actualAdr: 14_000,
      currentRevenue: 280_000,
    })
  })

  it('予測の稼働率は 100% を超えない', () => {
    const result = toRoomTypeDay({ ...day, predictedOccupancy: 1 }, { count: 10, hotelRooms: 100, mix: { roomShare: 0.5, adrRatio: 1 }, actual: null })
    expect(result.predictedOccupancy).toBe(1)
  })
})
