import { describe, it, expect } from 'vitest'
import { assertEventDateRange } from './eventsService.js'

function d(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m - 1, day))
}

describe('assertEventDateRange (S-4)', () => {
  const existing = { startDate: d(2026, 9, 10), endDate: d(2026, 9, 12) }

  it('開始日のみ更新して終了日を超える場合は 400 を投げる', () => {
    expect(() => assertEventDateRange(existing, { startDate: d(2026, 9, 13) })).toThrow(
      '開始日は終了日以前である必要があります'
    )
  })

  it('終了日のみ更新して開始日より前になる場合は 400 を投げる', () => {
    expect(() => assertEventDateRange(existing, { endDate: d(2026, 9, 9) })).toThrow()
  })

  it('両方更新して整合していれば通る', () => {
    expect(() =>
      assertEventDateRange(existing, { startDate: d(2026, 10, 1), endDate: d(2026, 10, 3) })
    ).not.toThrow()
  })

  it('開始日＝終了日（1日イベント）は許容する', () => {
    expect(() => assertEventDateRange(existing, { startDate: d(2026, 9, 12) })).not.toThrow()
  })

  it('日付を含まない更新は既存値で検証するため通る', () => {
    expect(() => assertEventDateRange(existing, {})).not.toThrow()
  })
})
