import { describe, it, expect } from 'vitest'
import {
  isJpHoliday,
  getJpHolidayName,
  isDayOff,
  hasHolidayData,
  getConsecutiveHolidayBlock,
} from './jpHolidays.js'

function d(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m - 1, day))
}

describe('isJpHoliday / getJpHolidayName', () => {
  it('国民の祝日を判定する', () => {
    expect(isJpHoliday(d(2026, 1, 1))).toBe(true)
    expect(getJpHolidayName(d(2026, 5, 5))).toBe('こどもの日')
    expect(isJpHoliday(d(2026, 6, 15))).toBe(false)
  })

  it('振替休日・国民の休日も祝日として扱う', () => {
    expect(isJpHoliday(d(2026, 5, 6))).toBe(true) // 憲法記念日(日)の振替
    expect(isJpHoliday(d(2026, 9, 22))).toBe(true) // 敬老の日と秋分の日に挟まれた国民の休日
  })
})

describe('hasHolidayData', () => {
  it('カバー範囲外の年は false（補正を適用しない）', () => {
    expect(hasHolidayData(d(2026, 8, 1))).toBe(true)
    expect(hasHolidayData(d(2030, 8, 1))).toBe(false)
    expect(hasHolidayData(d(2020, 8, 1))).toBe(false)
  })
})

describe('isDayOff', () => {
  it('土日・祝日を休みとして扱う', () => {
    expect(isDayOff(d(2026, 8, 22))).toBe(true) // 土曜
    expect(isDayOff(d(2026, 8, 23))).toBe(true) // 日曜
    expect(isDayOff(d(2026, 8, 24))).toBe(false) // 月曜（平日）
    expect(isDayOff(d(2026, 2, 23))).toBe(true) // 天皇誕生日（月曜）
  })
})

describe('getConsecutiveHolidayBlock', () => {
  it('GW（2026: 5/2土〜5/6水の5連休）を検出する', () => {
    // 5/2(土) 5/3(祝) 5/4(祝) 5/5(祝) 5/6(振替)
    expect(getConsecutiveHolidayBlock(d(2026, 5, 2))).toEqual({ length: 5, position: 1 })
    expect(getConsecutiveHolidayBlock(d(2026, 5, 4))).toEqual({ length: 5, position: 3 })
    expect(getConsecutiveHolidayBlock(d(2026, 5, 6))).toEqual({ length: 5, position: 5 })
  })

  it('シルバーウィーク（2026: 9/19土〜9/23水の5連休）を検出する', () => {
    expect(getConsecutiveHolidayBlock(d(2026, 9, 19))).toEqual({ length: 5, position: 1 })
    expect(getConsecutiveHolidayBlock(d(2026, 9, 22))).toEqual({ length: 5, position: 4 })
  })

  it('祝日を含まない通常の土日は連休として扱わない', () => {
    expect(getConsecutiveHolidayBlock(d(2026, 8, 22))).toBeNull() // 通常の土曜
  })

  it('平日は null', () => {
    expect(getConsecutiveHolidayBlock(d(2026, 8, 24))).toBeNull()
  })

  it('データ範囲外の年は null（誤った補正をかけない）', () => {
    expect(getConsecutiveHolidayBlock(d(2030, 5, 3))).toBeNull()
  })
})
