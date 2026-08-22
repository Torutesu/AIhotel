import { describe, it, expect } from 'vitest'
import { shouldNotify, NOTIFY_COOLDOWN_MS } from './opsNotifierService.js'

const now = new Date('2026-08-22T12:00:00Z')

describe('shouldNotify（通知抑制 §14.4）', () => {
  it('初回の事象は必ず通知する', () => {
    expect(shouldNotify(null, 'SEV1', now)).toBe(true)
  })

  it('一度回復した事象の再発は必ず通知する', () => {
    const prev = { lastNotifiedAt: new Date(now.getTime() - 1000), resolvedAt: new Date(now.getTime() - 500) }
    expect(shouldNotify(prev, 'SEV1', now)).toBe(true)
  })

  it('継続中の同一事象はクールダウン内なら抑制する（鳴りっぱなしで麻痺させない）', () => {
    const prev = { lastNotifiedAt: new Date(now.getTime() - 30 * 60 * 1000), resolvedAt: null }
    expect(shouldNotify(prev, 'SEV1', now)).toBe(false)
  })

  it('クールダウンを過ぎた継続事象は再通知する', () => {
    const prev = {
      lastNotifiedAt: new Date(now.getTime() - NOTIFY_COOLDOWN_MS.SEV1 - 1000),
      resolvedAt: null,
    }
    expect(shouldNotify(prev, 'SEV1', now)).toBe(true)
  })

  it('深刻度でクールダウンが異なる（SEV2はSEV1より長い）', () => {
    const elapsed = 3 * 60 * 60 * 1000 // 3時間経過
    const prev = { lastNotifiedAt: new Date(now.getTime() - elapsed), resolvedAt: null }
    expect(shouldNotify(prev, 'SEV1', now)).toBe(true) // SEV1: 1時間クールダウン → 送る
    expect(shouldNotify(prev, 'SEV2', now)).toBe(false) // SEV2: 6時間クールダウン → 抑制
  })
})
