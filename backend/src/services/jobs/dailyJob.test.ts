import { describe, it, expect } from 'vitest'
import { msUntilNextRun } from './dailyJob.js'

describe('msUntilNextRun', () => {
  it('JST の指定時刻が今日まだ来ていなければ今日、過ぎていれば翌日を返す', () => {
    // 2026-09-07 03:00 JST = 2026-09-06T18:00Z
    const before = new Date('2026-09-06T18:00:00Z')
    expect(msUntilNextRun(before, 4)).toBe(3_600_000)
    // 2026-09-07 05:00 JST = 2026-09-06T20:00Z → 翌日 04:00 JST まで 23 時間
    const after = new Date('2026-09-06T20:00:00Z')
    expect(msUntilNextRun(after, 4)).toBe(23 * 3_600_000)
  })
})
