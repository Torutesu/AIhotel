import { describe, it, expect } from 'vitest'
import {
  computeMovingAverageBySameWeekday,
  computeYearOverYearOccupancy,
  computeEventImpact,
  computeWeekendAdjustment,
  mapOccupancyToDemandLevel,
  mapOccupancyToRank,
  computePredictedOccupancy,
  computeConfidence,
  computeHolidayAdjustment,
  type OccupancyRecord,
  type EventImpactRecord,
} from './ruleBasedForecaster.js'

// UTC固定の日付ヘルパー（タイムゾーン依存の失敗を避ける）
function d(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m - 1, day))
}

describe('computeMovingAverageBySameWeekday', () => {
  it('直近28日以内の同曜日実績のみを平均する', () => {
    // targetDate = 2026-07-10 (金曜日)
    const target = d(2026, 7, 10)
    const history: OccupancyRecord[] = [
      { date: d(2026, 7, 3), occupancy: 0.8 }, // 金曜（28日以内）
      { date: d(2026, 6, 26), occupancy: 0.9 }, // 金曜（28日以内）
      { date: d(2026, 6, 4), occupancy: 0.5 }, // 木曜（曜日不一致 → 除外）
      { date: d(2026, 5, 1), occupancy: 0.99 }, // 28日より前 → 除外
    ]
    const result = computeMovingAverageBySameWeekday(history, target)
    expect(result).toBeCloseTo((0.8 + 0.9) / 2, 5)
  })

  it('該当データがなければ null を返す', () => {
    const target = d(2026, 7, 10)
    const result = computeMovingAverageBySameWeekday([], target)
    expect(result).toBeNull()
  })
})

describe('computeYearOverYearOccupancy', () => {
  it('前年同日にちょうど一致するデータがあればその稼働率を返す', () => {
    const target = d(2026, 7, 10)
    const history: OccupancyRecord[] = [
      { date: d(2025, 7, 1), occupancy: 0.5 }, // 許容範囲外
      { date: d(2025, 7, 10), occupancy: 0.7 }, // 前年同日ちょうど
    ]
    const result = computeYearOverYearOccupancy(history, target, 3)
    expect(result).toBeCloseTo(0.7, 5)
  })

  it('許容範囲外なら null を返す', () => {
    const target = d(2026, 7, 10)
    const history: OccupancyRecord[] = [{ date: d(2025, 1, 1), occupancy: 0.5 }]
    const result = computeYearOverYearOccupancy(history, target, 3)
    expect(result).toBeNull()
  })
})

describe('computeEventImpact', () => {
  it('期間内のイベント影響度を合算する（high=+15pt, low=+3pt）', () => {
    const target = d(2026, 7, 10)
    const events: EventImpactRecord[] = [
      { startDate: d(2026, 7, 9), endDate: d(2026, 7, 11), expectedImpact: 'high' },
      { startDate: d(2026, 7, 10), endDate: d(2026, 7, 10), expectedImpact: 'low' },
    ]
    expect(computeEventImpact(events, target)).toBeCloseTo(0.15 + 0.03, 5)
  })

  it('期間外のイベントは影響しない', () => {
    const target = d(2026, 7, 10)
    const events: EventImpactRecord[] = [
      { startDate: d(2026, 8, 1), endDate: d(2026, 8, 3), expectedImpact: 'high' },
    ]
    expect(computeEventImpact(events, target)).toBe(0)
  })
})

describe('computeWeekendAdjustment', () => {
  it('Hotel.weekendDays に含まれる曜日には補正を加える（ハードコードせず引数で判定）', () => {
    // 2026-07-10 は金曜日 (dow=5)
    const target = d(2026, 7, 10)
    expect(computeWeekendAdjustment(target, [5, 6])).toBeGreaterThan(0)
    expect(computeWeekendAdjustment(target, [0, 1])).toBe(0)
  })

  it('weekendDays が異なる定義（例: 木・金）でも正しく反映する', () => {
    const thursday = d(2026, 7, 9)
    expect(computeWeekendAdjustment(thursday, [4, 5])).toBeGreaterThan(0)
  })
})

describe('mapOccupancyToDemandLevel', () => {
  it.each([
    [0.95, 'A'],
    [0.85, 'B'],
    [0.7, 'C'],
    [0.55, 'D'],
    [0.3, 'E'],
  ] as const)('稼働率 %f は需要レベル %s にマップされる', (occupancy, expected) => {
    expect(mapOccupancyToDemandLevel(occupancy)).toBe(expected)
  })
})

describe('mapOccupancyToRank', () => {
  it('稼働率を1〜maxRankの範囲にマップする', () => {
    expect(mapOccupancyToRank(1, 40)).toBe(40)
    expect(mapOccupancyToRank(0, 40)).toBe(1)
    expect(mapOccupancyToRank(0.5, 40)).toBe(20)
  })

  it('maxRank が40以外でも範囲内に収める', () => {
    expect(mapOccupancyToRank(1.5, 10)).toBe(10)
    expect(mapOccupancyToRank(-0.5, 10)).toBe(1)
  })
})

describe('computePredictedOccupancy', () => {
  it('移動平均と前年比較の両方があれば0.7:0.3で加重平均する', () => {
    const result = computePredictedOccupancy({
      movingAverage: 0.8,
      yearOverYear: 0.6,
      eventImpact: 0,
      weekendAdjustment: 0,
    })
    expect(result).toBeCloseTo(0.8 * 0.7 + 0.6 * 0.3, 5)
  })

  it('どちらもなければフォールバック値を使う', () => {
    const result = computePredictedOccupancy({
      movingAverage: null,
      yearOverYear: null,
      eventImpact: 0,
      weekendAdjustment: 0,
      fallback: 0.6,
    })
    expect(result).toBeCloseTo(0.6, 5)
  })

  it('イベント補正・週末補正を加算し、1.0を超えないようclampする', () => {
    const result = computePredictedOccupancy({
      movingAverage: 0.95,
      yearOverYear: 0.95,
      eventImpact: 0.15,
      weekendAdjustment: 0.05,
    })
    expect(result).toBe(1)
  })

  it('負の値にならないようclampする', () => {
    const result = computePredictedOccupancy({
      movingAverage: 0,
      yearOverYear: 0,
      eventImpact: 0,
      weekendAdjustment: 0,
      fallback: 0,
    })
    expect(result).toBe(0)
  })
})

describe('computeConfidence', () => {
  it('移動平均と前年比較の両方があれば最も高い確信度を返す', () => {
    expect(computeConfidence({ movingAverage: 0.8, yearOverYear: 0.7 })).toBe(0.85)
  })

  it('データが全くなければ最も低い確信度を返す', () => {
    expect(computeConfidence({ movingAverage: null, yearOverYear: null })).toBe(0.4)
  })
})

describe('computeHolidayAdjustment', () => {
  it('翌日が祝日の平日夜には補正を加える', () => {
    // 2026-02-22(日) の夜: 翌日2/23が天皇誕生日
    expect(computeHolidayAdjustment(d(2026, 2, 22), [5, 6])).toBeGreaterThan(0)
  })

  it('weekendDays に含まれる曜日は週末補正と二重加算しない', () => {
    // 2025-05-02(金): 翌日5/3が憲法記念日だが、金曜は週末補正の対象
    const friday = d(2025, 5, 2)
    const withWeekendDef = computeHolidayAdjustment(friday, [5, 6])
    const withoutWeekendDef = computeHolidayAdjustment(friday, [0, 1])
    expect(withoutWeekendDef).toBeGreaterThan(withWeekendDef)
  })

  it('3連休以上の中日にはさらに補正を加える', () => {
    // 2026 GW: 5/2(土)〜5/6(水)の5連休。5/4は中日
    const midBlock = computeHolidayAdjustment(d(2026, 5, 4), [5, 6])
    expect(midBlock).toBeGreaterThan(0)
  })

  it('連休最終日（翌日から平日）は連休補正を加えない', () => {
    // 2026-05-06(水・振替): 連休最終日。翌日は平日
    expect(computeHolidayAdjustment(d(2026, 5, 6), [5, 6])).toBe(0)
  })

  it('祝日と無関係な平日は補正なし', () => {
    expect(computeHolidayAdjustment(d(2026, 6, 16), [5, 6])).toBe(0)
  })
})
