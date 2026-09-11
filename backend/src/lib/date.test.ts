import { describe, it, expect } from 'vitest'
import { DEFAULT_WEEKEND_DAYS, addUtcDays, dateOnly, monthRange, todayJst } from './date.js'

describe('todayJst (C-6)', () => {
  it('UTC では前日でも JST の暦日を返す', () => {
    // 2026-09-11T23:30:00Z は JST では 2026-09-12 08:30
    expect(todayJst(new Date('2026-09-11T23:30:00Z')).toISOString()).toBe('2026-09-12T00:00:00.000Z')
  })

  it('JST の 00:00 ちょうどでその日を返す', () => {
    // 2026-09-11T15:00:00Z = JST 2026-09-12 00:00
    expect(todayJst(new Date('2026-09-11T15:00:00Z')).toISOString()).toBe('2026-09-12T00:00:00.000Z')
  })

  it('JST の 23:59 でも同じ日を返す', () => {
    // 2026-09-12T14:59:00Z = JST 2026-09-12 23:59
    expect(todayJst(new Date('2026-09-12T14:59:00Z')).toISOString()).toBe('2026-09-12T00:00:00.000Z')
  })

  it('月またぎ・年またぎでも正しく繰り上がる', () => {
    // 2025-12-31T15:00:00Z = JST 2026-01-01 00:00
    expect(todayJst(new Date('2025-12-31T15:00:00Z')).toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })

  it('常に時刻が 00:00:00.000 UTC に丸められる', () => {
    const t = todayJst(new Date('2026-09-11T07:23:45.678Z'))
    expect(t.getUTCHours()).toBe(0)
    expect(t.getUTCMinutes()).toBe(0)
    expect(t.getUTCMilliseconds()).toBe(0)
  })
})

describe('dateOnly (C-6)', () => {
  it('時刻を切り落とす', () => {
    expect(dateOnly(new Date('2026-09-11T13:45:12.900Z')).toISOString()).toBe(
      '2026-09-11T00:00:00.000Z'
    )
  })

  it('元の Date を破壊しない', () => {
    const src = new Date('2026-09-11T13:45:12.900Z')
    dateOnly(src)
    expect(src.toISOString()).toBe('2026-09-11T13:45:12.900Z')
  })
})

describe('addUtcDays (C-6)', () => {
  it('日数を加算する', () => {
    expect(addUtcDays(new Date('2026-09-11T00:00:00Z'), 5).toISOString()).toBe(
      '2026-09-16T00:00:00.000Z'
    )
  })

  it('負数で減算でき、月をまたいで繰り下がる', () => {
    expect(addUtcDays(new Date('2026-09-01T00:00:00Z'), -1).toISOString()).toBe(
      '2026-08-31T00:00:00.000Z'
    )
  })

  it('元の Date を破壊しない', () => {
    const src = new Date('2026-09-11T00:00:00Z')
    addUtcDays(src, 10)
    expect(src.toISOString()).toBe('2026-09-11T00:00:00.000Z')
  })
})

describe('monthRange (C-6)', () => {
  it('月初と翌月初（半開区間）と日数を返す', () => {
    const r = monthRange(2026, 9)
    expect(r.start.toISOString()).toBe('2026-09-01T00:00:00.000Z')
    expect(r.end.toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(r.daysInMonth).toBe(30)
  })

  it('12月は翌年1月初を end にする', () => {
    const r = monthRange(2026, 12)
    expect(r.end.toISOString()).toBe('2027-01-01T00:00:00.000Z')
    expect(r.daysInMonth).toBe(31)
  })

  it('うるう年の2月は29日', () => {
    expect(monthRange(2028, 2).daysInMonth).toBe(29)
    expect(monthRange(2026, 2).daysInMonth).toBe(28)
  })
})

describe('DEFAULT_WEEKEND_DAYS (C-6)', () => {
  it('週末は金(5)・土(6)（F-DAILY-02）', () => {
    expect([...DEFAULT_WEEKEND_DAYS]).toEqual([5, 6])
  })
})
