import { describe, it, expect } from 'vitest'
import { outcomeAt, simulateOccupancy } from './daySimulation.js'
import { pickSimilarDays } from '../dayInsightService.js'

// 日単位のシミュレーション（2026-10 PDF b01）と、日のAI分析の「同じタイプの日」（PDF b03）

describe('simulateOccupancy', () => {
  const base = { baseOccupancy: 0.8, basePrice: 20_000, elasticity: 1, totalRooms: 100, otbRooms: 30 }

  it('価格を上げると価格弾力性のぶん稼働が下がり、下げると上がる', () => {
    expect(simulateOccupancy({ ...base, price: 22_000 })).toBeCloseTo(0.8 * (1.1 ** -1), 3)
    expect(simulateOccupancy({ ...base, price: 18_000 })).toBeCloseTo(0.8 * (0.9 ** -1), 3)
  })

  it('予約済みの室数を下回らず、客室数を上回らない', () => {
    expect(simulateOccupancy({ ...base, price: 60_000 })).toBe(0.3)
    expect(simulateOccupancy({ ...base, price: 10_000 })).toBe(1)
  })

  it('価格弾力性 0 なら稼働は変わらない', () => {
    expect(simulateOccupancy({ ...base, elasticity: 0, price: 30_000 })).toBe(0.8)
  })

  it('稼働から室数・売上・REV-Per を出す', () => {
    expect(outcomeAt(0.82, 20_000, 100)).toEqual({ occupancy: 0.82, rooms: 82, revenue: 1_640_000, revPar: 16_400 })
  })
})

describe('pickSimilarDays', () => {
  const day = (date: string, dayType: string | null) => ({ date, dayType })
  const candidates = [
    day('2026-11-01', '平日A型'),
    day('2026-11-05', '平日B型'),
    day('2026-11-08', '平日A型'),
    day('2026-11-12', '平日A型'),
    day('2026-11-13', '平日A型'),
    day('2026-11-20', '平日A型'),
    day('2026-11-28', '平日A型'),
    day('2026-12-30', '平日A型'),
  ]

  it('同じ型の日を日付の近い順に5日選び、日付順に並べる（自分自身は除く）', () => {
    const picked = pickSimilarDays([...candidates, day('2026-11-10', '平日A型')], day('2026-11-10', '平日A型'))
    expect(picked.map((d) => d.date)).toEqual(['2026-11-01', '2026-11-08', '2026-11-12', '2026-11-13', '2026-11-20'])
  })

  it('型が無い日は選ばない', () => {
    expect(pickSimilarDays(candidates, day('2026-11-10', null))).toEqual([])
  })
})
