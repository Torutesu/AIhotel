import { describe, it, expect } from 'vitest'
import { distanceDecay, estimateDemandPressure, estimateEventImpact } from './eventImpact.js'

describe('eventImpact', () => {
  it('距離減衰は2km以内で1、遠いほど小さい', () => {
    expect(distanceDecay(1)).toBe(1)
    expect(distanceDecay(10)).toBeLessThan(0.4)
    expect(distanceDecay(10)).toBeGreaterThan(distanceDecay(20))
    expect(distanceDecay(null)).toBe(0.6)
  })

  it('東京ドーム級（5.5万人）が近くにあれば high、小ホールは low', () => {
    expect(estimateEventImpact({ capacity: 55000, distanceKm: 1.5, totalRooms: 200 })).toBe('high')
    expect(estimateEventImpact({ capacity: 800, distanceKm: 1, totalRooms: 200 })).toBe('low')
    expect(estimateEventImpact({ capacity: null, distanceKm: 1, totalRooms: 200 })).toBeNull()
  })

  it('来場者数が分かれば収容人数より優先する', () => {
    const p1 = estimateDemandPressure({ capacity: 55000, distanceKm: 1, totalRooms: 200, expectedAttendance: 2000 })
    const p2 = estimateDemandPressure({ capacity: 55000, distanceKm: 1, totalRooms: 200 })
    expect(p1!).toBeLessThan(p2!)
  })
})
