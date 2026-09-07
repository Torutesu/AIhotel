import { describe, it, expect } from 'vitest'
import { DEFAULT_BOOKING_CURVE, typicalFraction, buildCurveFromHistory, projectOccupancyFromPace } from './bookingCurve.js'

describe('typicalFraction', () => {
  it('曲線上の点はそのまま、間は線形補間する', () => {
    expect(typicalFraction(DEFAULT_BOOKING_CURVE, 0)).toBe(1)
    expect(typicalFraction(DEFAULT_BOOKING_CURVE, 7)).toBe(0.65)
    expect(typicalFraction(DEFAULT_BOOKING_CURVE, 10)).toBeCloseTo(0.65 + (0.48 - 0.65) * (3 / 7), 6)
    expect(typicalFraction(DEFAULT_BOOKING_CURVE, 200)).toBe(0.06)
  })
})

describe('buildCurveFromHistory', () => {
  it('サンプルが5件未満ならデフォルト曲線を返す', () => {
    const r = buildCurveFromHistory([{ stayDate: new Date('2026-01-01'), daysBefore: 0, roomsBooked: 100 }])
    expect(r.curve).toBe(DEFAULT_BOOKING_CURVE)
    expect(r.samples).toBe(1)
  })

  it('十分な履歴があればリードタイム別の中央値比率で曲線を作る', () => {
    const records = []
    for (let i = 0; i < 6; i++) {
      const stayDate = new Date(Date.UTC(2026, 0, 1 + i))
      records.push({ stayDate, daysBefore: 0, roomsBooked: 100 })
      records.push({ stayDate, daysBefore: 7, roomsBooked: 50 + i }) // 0.50〜0.55
    }
    const r = buildCurveFromHistory(records)
    expect(r.samples).toBe(6)
    expect(typicalFraction(r.curve, 7)).toBeCloseTo(0.53, 6)
  })
})

describe('projectOccupancyFromPace', () => {
  it('OTB を典型積上率で割って最終稼働率を投影する', () => {
    // 7日前に 130室/200室 = 65% → 典型 65% なので最終 100%
    expect(projectOccupancyFromPace({ roomsOnBooks: 130, daysBefore: 7, totalRooms: 200, curve: DEFAULT_BOOKING_CURVE })).toBeCloseTo(1, 6)
    expect(projectOccupancyFromPace({ roomsOnBooks: 65, daysBefore: 7, totalRooms: 200, curve: DEFAULT_BOOKING_CURVE })).toBeCloseTo(0.5, 6)
  })

  it('上限 1.2 で頭打ちにする', () => {
    expect(projectOccupancyFromPace({ roomsOnBooks: 200, daysBefore: 30, totalRooms: 200, curve: DEFAULT_BOOKING_CURVE })).toBe(1.2)
  })
})
