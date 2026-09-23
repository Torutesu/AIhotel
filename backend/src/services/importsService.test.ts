import { describe, it, expect } from 'vitest'
import { computeDailyMetrics, findImportRowErrors } from './importsService.js'

describe('computeDailyMetrics（#82）', () => {
  it('客室数から稼働率・ADR・RevPAR を算出する', () => {
    expect(computeDailyMetrics(80, 1_600_000, 100)).toEqual({ occupancy: 0.8, adr: 20_000, revPar: 16_000 })
  })

  it('販売室数が0の日は ADR を出さない', () => {
    expect(computeDailyMetrics(0, 0, 100)).toEqual({ occupancy: 0, adr: null, revPar: 0 })
  })
})

describe('findImportRowErrors（#82）', () => {
  it('日付の重複・客室数超過・室数0で売上ありを行番号つきで返す', () => {
    const errors = findImportRowErrors(
      [
        { date: '2026-09-01', soldRooms: 50, totalRevenue: 1_000_000 },
        { date: '2026-09-02', soldRooms: 120, totalRevenue: 1_000_000 },
        { date: '2026-09-01', soldRooms: 0, totalRevenue: 5_000 },
      ],
      100
    )
    expect(errors).toEqual([
      { field: 'rows.1.soldRooms', message: '販売室数 120 がホテルの客室数 100 を超えています' },
      { field: 'rows.2.date', message: '日付 2026-09-01 が 1 行目と重複しています' },
      { field: 'rows.2.totalRevenue', message: '販売室数が0なのに室料売上があります' },
    ])
  })

  it('問題が無ければ空配列', () => {
    expect(findImportRowErrors([{ date: '2026-09-01', soldRooms: 100, totalRevenue: 0 }], 100)).toEqual([])
  })
})
