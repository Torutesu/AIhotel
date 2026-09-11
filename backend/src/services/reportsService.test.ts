import { describe, it, expect } from 'vitest'
import { dataVersionKey, isReportCacheable, monthsElapsedSince } from './reportsService.js'

const today = new Date(Date.UTC(2026, 8, 11)) // 2026-09-11

describe('monthsElapsedSince (C-2)', () => {
  it('当月は0', () => {
    expect(monthsElapsedSince(2026, 9, today)).toBe(0)
  })

  it('前月は1、2か月前は2', () => {
    expect(monthsElapsedSince(2026, 8, today)).toBe(1)
    expect(monthsElapsedSince(2026, 7, today)).toBe(2)
  })

  it('年をまたいでも数えられる', () => {
    expect(monthsElapsedSince(2025, 9, today)).toBe(12)
    expect(monthsElapsedSince(2025, 12, today)).toBe(9)
  })

  it('未来月は負数', () => {
    expect(monthsElapsedSince(2026, 10, today)).toBe(-1)
  })
})

describe('isReportCacheable (C-2)', () => {
  it('当月はキャッシュしない', () => {
    expect(isReportCacheable(2026, 9, today)).toBe(false)
  })

  it('直近2か月（前月・2か月前）はキャッシュしない', () => {
    expect(isReportCacheable(2026, 8, today)).toBe(false)
    expect(isReportCacheable(2026, 7, today)).toBe(false)
  })

  it('3か月前以降はキャッシュする', () => {
    expect(isReportCacheable(2026, 6, today)).toBe(true)
    expect(isReportCacheable(2025, 12, today)).toBe(true)
  })

  it('未来月はキャッシュしない', () => {
    expect(isReportCacheable(2026, 10, today)).toBe(false)
  })

  it('年をまたぐ境界（1月表示・前年11月）でも正しく判定する', () => {
    const jan = new Date(Date.UTC(2026, 0, 15)) // 2026-01-15
    expect(isReportCacheable(2025, 12, jan)).toBe(false) // 1か月前
    expect(isReportCacheable(2025, 11, jan)).toBe(false) // 2か月前
    expect(isReportCacheable(2025, 10, jan)).toBe(true) // 3か月前
  })
})

describe('dataVersionKey (C-2)', () => {
  it('updatedAt が変わるとキーが変わる（再生成される）', () => {
    const a = dataVersionKey(new Date('2026-06-30T10:00:00Z'))
    const b = dataVersionKey(new Date('2026-07-01T10:00:00Z'))
    expect(a).not.toBe(b)
  })

  it('同じ updatedAt なら同じキー（キャッシュが効く）', () => {
    const d = new Date('2026-06-30T10:00:00Z')
    expect(dataVersionKey(d)).toBe(dataVersionKey(new Date(d)))
  })

  it('元データが無い場合は v0', () => {
    expect(dataVersionKey(null)).toBe('v0')
    expect(dataVersionKey(null, undefined, null)).toBe('v0')
  })

  it('予算やホテル設定だけが更新されてもキーが変わる（R-4）', () => {
    const daily = new Date('2026-06-30T10:00:00Z')
    const before = dataVersionKey(daily, new Date('2026-06-30T09:00:00Z'), null)
    const budgetUpdated = dataVersionKey(daily, new Date('2026-07-05T09:00:00Z'), null)
    const hotelUpdated = dataVersionKey(daily, null, new Date('2026-07-06T09:00:00Z'))

    expect(before).not.toBe(budgetUpdated)
    expect(before).not.toBe(hotelUpdated)
  })

  it('最大の updatedAt が採用される（引数の順序に依存しない）', () => {
    const a = new Date('2026-06-01T00:00:00Z')
    const b = new Date('2026-07-01T00:00:00Z')
    expect(dataVersionKey(a, b)).toBe(dataVersionKey(b, a))
    expect(dataVersionKey(a, b)).toBe(`v${b.getTime()}`)
  })
})
