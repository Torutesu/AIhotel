import { describe, it, expect } from 'vitest'
import {
  computeHolidaySignal,
  holidayFactorKeys,
  isOffDay,
  getSpecialPeriod,
  getSchoolBreak,
} from './holidaySignal.js'

function d(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m - 1, day))
}

describe('isOffDay', () => {
  it('土日と祝日を休みと判定する', () => {
    expect(isOffDay(d(2026, 9, 19))).toBe(true) // 土
    expect(isOffDay(d(2026, 9, 21))).toBe(true) // 敬老の日（月）
    expect(isOffDay(d(2026, 9, 22))).toBe(true) // 国民の休日
    expect(isOffDay(d(2026, 9, 24))).toBe(false) // 木
  })
})

describe('computeHolidaySignal — 2026年シルバーウィーク（9/19土〜9/23水の5連休）', () => {
  it('9/18（金）は連休前夜。ブロック長5・祝日を含む', () => {
    const s = computeHolidaySignal(d(2026, 9, 18))
    expect(s.position).toBe('eve')
    expect(s.blockLength).toBe(5)
    expect(s.blockHasHoliday).toBe(true)
    expect(s.nextDayIsHoliday).toBe(false) // 翌日は土曜
    expect(holidayFactorKeys(s)).toEqual(['holiday:eve'])
  })

  it('9/20（日）は連休中。翌日は祝日（敬老の日）', () => {
    const s = computeHolidaySignal(d(2026, 9, 20))
    expect(s.position).toBe('within')
    expect(s.nextDayIsHoliday).toBe(true)
    expect(holidayFactorKeys(s)).toEqual(['holiday:within_long'])
  })

  it('9/23（水・秋分の日）は連休最終夜', () => {
    const s = computeHolidaySignal(d(2026, 9, 23))
    expect(s.isHoliday).toBe(true)
    expect(s.holidayName).toBe('秋分の日')
    expect(s.position).toBe('last')
    expect(holidayFactorKeys(s)).toEqual(['holiday:last'])
  })
})

describe('computeHolidaySignal — 土日だけの週末は要因キーを出さない', () => {
  it('2026-09-11（金）: 翌日は土曜だが祝日を含まないため base に任せる', () => {
    const s = computeHolidaySignal(d(2026, 9, 11))
    expect(s.position).toBe('eve')
    expect(s.blockHasHoliday).toBe(false)
    expect(holidayFactorKeys(s)).toEqual([])
  })
})

describe('computeHolidaySignal — 飛び石', () => {
  it('2026-11-02（月）: 前日は日曜、翌日は文化の日 → 飛び石', () => {
    const s = computeHolidaySignal(d(2026, 11, 2))
    expect(s.isBridgeDay).toBe(true)
    expect(s.position).toBe('eve')
    expect(s.nextDayIsHoliday).toBe(true)
    expect(holidayFactorKeys(s)).toEqual(['holiday:eve', 'holiday:bridge'])
  })

  it('2026-05-01（金）はGW中の平日だが前日(4/30)が平日なので飛び石ではない', () => {
    const s = computeHolidaySignal(d(2026, 5, 1))
    expect(s.isBridgeDay).toBe(false)
    expect(s.specialPeriod).toBe('gw')
  })
})

describe('特別期間・学校休暇', () => {
  it('GW・お盆・年末年始を判定する', () => {
    expect(getSpecialPeriod(d(2026, 5, 3))).toBe('gw')
    expect(getSpecialPeriod(d(2026, 8, 13))).toBe('obon')
    expect(getSpecialPeriod(d(2026, 12, 31))).toBe('nenmatsu')
    expect(getSpecialPeriod(d(2027, 1, 2))).toBe('nenmatsu')
    expect(getSpecialPeriod(d(2026, 6, 10))).toBeNull()
  })

  it('学校休暇を判定する', () => {
    expect(getSchoolBreak(d(2026, 8, 5))).toBe('summer')
    expect(getSchoolBreak(d(2026, 3, 28))).toBe('spring')
    expect(getSchoolBreak(d(2026, 12, 26))).toBe('winter')
    expect(getSchoolBreak(d(2026, 10, 1))).toBeNull()
  })

  it('要因キーに特別期間と学校休暇が乗る', () => {
    const keys = holidayFactorKeys(computeHolidaySignal(d(2026, 8, 13)))
    expect(keys).toContain('special:obon')
    expect(keys).toContain('school:summer')
  })
})

describe('収録範囲外', () => {
  it('収録最終年より先は known=false', () => {
    expect(computeHolidaySignal(d(2040, 1, 1)).known).toBe(false)
    expect(computeHolidaySignal(d(2026, 1, 1)).known).toBe(true)
  })
})
