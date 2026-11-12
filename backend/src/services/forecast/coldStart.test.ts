import { describe, expect, it } from 'vitest'
import { coldStartOccupancy, defaultShareAt } from './coldStart.js'
import { parseWeekdays } from '../setupWorkbookService.js'

// 実績の少ないホテルの需要予測（D-13）
describe('coldStartOccupancy', () => {
  it('典型の割合は残日数の間を直線で補い、180日より先は 180日の値', () => {
    expect(defaultShareAt('LIMITED_SERVICE', 14)).toBe(0.65)
    expect(defaultShareAt('LIMITED_SERVICE', 22)).toBeCloseTo(0.55, 2)
    expect(defaultShareAt('RESORT', 300)).toBe(0.15)
  })
  it('今の予約から引き延ばし、予約が多いほど引き延ばしを信じる', () => {
    // 60室 ÷ 0.65 ÷ 120室 ≈ 0.769。重み 0.5 + (0.65 − 0.2) × 0.625 ≈ 0.78 → 典型 0.78 と混ぜて ≈ 0.772
    const r = coldStartOccupancy({ hotelType: 'LIMITED_SERVICE', lead: 14, otbRooms: 60, totalRooms: 120 })
    expect(r).toMatchObject({ method: 'extrapolated', share: 0.65 })
    expect(r!.occupancy).toBeCloseTo(0.772, 2)
  })
  it('遠い先・予約の記録が無い日はホテルタイプの典型、タイプ未設定なら null', () => {
    expect(coldStartOccupancy({ hotelType: 'LIMITED_SERVICE', lead: 150, otbRooms: 5, totalRooms: 120 })).toMatchObject({ method: 'typical', occupancy: 0.78 })
    expect(coldStartOccupancy({ hotelType: 'RYOKAN', lead: 10, otbRooms: null, totalRooms: 30 })?.occupancy).toBe(0.58)
    expect(coldStartOccupancy({ hotelType: null, lead: 10, otbRooms: 10, totalRooms: 30 })).toBeNull()
  })
})

describe('parseWeekdays（初期設定シートの週末）', () => {
  it('曜日の書き方の揺れを読み、重複・読めない文字は null', () => {
    expect(parseWeekdays('金・土')).toEqual([5, 6])
    expect(parseWeekdays('土曜日, 日曜日')).toEqual([0, 6])
    expect(parseWeekdays('金土')).toEqual([5, 6])
    expect(parseWeekdays('金・金')).toBeNull()
    expect(parseWeekdays('Fri')).toBeNull()
  })
})
