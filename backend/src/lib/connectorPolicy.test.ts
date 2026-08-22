import { describe, it, expect } from 'vitest'
import {
  computeBackoffMs,
  decideFailureHandling,
  decideLeaseExpiry,
  evaluateHotelHealth,
  isReadDataUsableForRecommendation,
  READ_MAX_ATTEMPTS,
  WRITE_MAX_ATTEMPTS,
} from './connectorPolicy.js'

const HOUR = 60 * 60 * 1000
const now = new Date('2026-08-22T12:00:00Z')

describe('decideFailureHandling', () => {
  it('認証失敗は残り試行回数に関わらず即FAILED（自動リトライでアカウントロックを起こさない）', () => {
    const decision = decideFailureHandling({
      direction: 'READ',
      errorCode: 'AUTH_FAILED',
      attemptCount: 1,
      maxAttempts: READ_MAX_ATTEMPTS,
    })
    expect(decision.nextStatus).toBe('FAILED')
    expect(decision.notify?.severity).toBe('SEV1')
  })

  it('WRITEの認証失敗はWRITE凍結も行う', () => {
    const decision = decideFailureHandling({
      direction: 'WRITE',
      errorCode: 'AUTH_FAILED',
      attemptCount: 1,
      maxAttempts: WRITE_MAX_ATTEMPTS,
    })
    expect(decision.freezeWrites).toBe(true)
  })

  it('一過性エラー（ネットワーク断）はバックオフ付きでPENDINGに戻す', () => {
    const decision = decideFailureHandling({
      direction: 'READ',
      errorCode: 'NETWORK',
      attemptCount: 1,
      maxAttempts: READ_MAX_ATTEMPTS,
    })
    expect(decision.nextStatus).toBe('PENDING')
    expect(decision.retryDelayMs).toBeGreaterThan(0)
  })

  it('試行回数を使い切った一過性エラーは終局FAILED', () => {
    const decision = decideFailureHandling({
      direction: 'READ',
      errorCode: 'NETWORK',
      attemptCount: READ_MAX_ATTEMPTS,
      maxAttempts: READ_MAX_ATTEMPTS,
    })
    expect(decision.nextStatus).toBe('FAILED')
  })

  it('書き込み検証不一致はリトライ1回→NEEDS_REVIEW＋WRITE凍結（§10.4）', () => {
    const first = decideFailureHandling({
      direction: 'WRITE',
      errorCode: 'VERIFY_MISMATCH',
      attemptCount: 1,
      maxAttempts: WRITE_MAX_ATTEMPTS,
    })
    expect(first.nextStatus).toBe('PENDING')

    const second = decideFailureHandling({
      direction: 'WRITE',
      errorCode: 'VERIFY_MISMATCH',
      attemptCount: WRITE_MAX_ATTEMPTS,
      maxAttempts: WRITE_MAX_ATTEMPTS,
    })
    expect(second.nextStatus).toBe('NEEDS_REVIEW')
    expect(second.freezeWrites).toBe(true)
    expect(second.notify?.severity).toBe('SEV1')
  })

  it('前提値不一致（同時操作競合）は上書きせずCANCELLED', () => {
    const decision = decideFailureHandling({
      direction: 'WRITE',
      errorCode: 'PRECONDITION_CHANGED',
      attemptCount: 1,
      maxAttempts: WRITE_MAX_ATTEMPTS,
    })
    expect(decision.nextStatus).toBe('CANCELLED')
    expect(decision.freezeWrites).toBe(false)
  })

  it('画面変更（セレクタ不一致）はリトライせずFAILED＋SEV2通知', () => {
    const decision = decideFailureHandling({
      direction: 'READ',
      errorCode: 'SELECTOR_MISMATCH',
      attemptCount: 1,
      maxAttempts: READ_MAX_ATTEMPTS,
    })
    expect(decision.nextStatus).toBe('FAILED')
    expect(decision.notify?.eventKey).toBe('SELECTOR_MISMATCH')
  })
})

describe('decideLeaseExpiry', () => {
  it('READのリース切れは自動再割当（PENDINGへ）', () => {
    const decision = decideLeaseExpiry({ direction: 'READ', attemptCount: 1, maxAttempts: READ_MAX_ATTEMPTS })
    expect(decision.nextStatus).toBe('PENDING')
  })

  it('WRITEのリース切れは「書けたか不明」なので自動再実行せずNEEDS_REVIEW＋凍結', () => {
    const decision = decideLeaseExpiry({ direction: 'WRITE', attemptCount: 1, maxAttempts: WRITE_MAX_ATTEMPTS })
    expect(decision.nextStatus).toBe('NEEDS_REVIEW')
    expect(decision.freezeWrites).toBe(true)
    expect(decision.notify?.severity).toBe('SEV1')
  })
})

describe('computeBackoffMs', () => {
  it('指数的に増加し上限30分で頭打ちになる', () => {
    expect(computeBackoffMs(1)).toBe(60_000)
    expect(computeBackoffMs(2)).toBe(120_000)
    expect(computeBackoffMs(3)).toBe(240_000)
    expect(computeBackoffMs(20)).toBe(30 * 60_000)
  })
})

describe('evaluateHotelHealth（デッドマン方式 §14.1）', () => {
  it('全デバイスのheartbeatが5分以上途絶したらSEV1を発火する', () => {
    const result = evaluateHotelHealth({
      now,
      lastSuccessfulReadAt: new Date(now.getTime() - HOUR),
      consecutiveReadFails: 0,
      deviceLastSeenAts: [new Date(now.getTime() - 10 * 60 * 1000)],
    })
    expect(result.fire.map((f) => f.eventKey)).toContain('ALL_DEVICES_DOWN')
  })

  it('1台でも生きていればALL_DEVICES_DOWNは回復扱いになる', () => {
    const result = evaluateHotelHealth({
      now,
      lastSuccessfulReadAt: new Date(now.getTime() - HOUR),
      consecutiveReadFails: 0,
      deviceLastSeenAts: [new Date(now.getTime() - 10 * 60 * 1000), new Date(now.getTime() - 60 * 1000)],
    })
    expect(result.fire.map((f) => f.eventKey)).not.toContain('ALL_DEVICES_DOWN')
    expect(result.resolve).toContain('ALL_DEVICES_DOWN')
  })

  it('デバイス未導入のホテルではALL_DEVICES_DOWNを発火しない（導入前ノイズ回避）', () => {
    const result = evaluateHotelHealth({
      now,
      lastSuccessfulReadAt: null,
      consecutiveReadFails: 0,
      deviceLastSeenAts: [],
    })
    expect(result.fire).toHaveLength(0)
  })

  it('鮮度SLO: 12時間超でSEV2、24時間超でSEV1に段階エスカレーションする', () => {
    const at13h = evaluateHotelHealth({
      now,
      lastSuccessfulReadAt: new Date(now.getTime() - 13 * HOUR),
      consecutiveReadFails: 0,
      deviceLastSeenAts: [new Date(now.getTime() - 1000)],
    })
    expect(at13h.fire.find((f) => f.eventKey === 'STALE_READ_12H')?.severity).toBe('SEV2')

    const at25h = evaluateHotelHealth({
      now,
      lastSuccessfulReadAt: new Date(now.getTime() - 25 * HOUR),
      consecutiveReadFails: 0,
      deviceLastSeenAts: [new Date(now.getTime() - 1000)],
    })
    expect(at25h.fire.find((f) => f.eventKey === 'STALE_READ_24H')?.severity).toBe('SEV1')
  })

  it('鮮度が正常範囲なら停止系事象を回復扱いにする（解決通知の入力）', () => {
    const result = evaluateHotelHealth({
      now,
      lastSuccessfulReadAt: new Date(now.getTime() - HOUR),
      consecutiveReadFails: 0,
      deviceLastSeenAts: [new Date(now.getTime() - 1000)],
    })
    expect(result.resolve).toEqual(expect.arrayContaining(['STALE_READ_12H', 'STALE_READ_24H']))
  })

  it('READ連続失敗が閾値以上でSEV2を発火する', () => {
    const result = evaluateHotelHealth({
      now,
      lastSuccessfulReadAt: new Date(now.getTime() - HOUR),
      consecutiveReadFails: 3,
      deviceLastSeenAts: [new Date(now.getTime() - 1000)],
    })
    expect(result.fire.find((f) => f.eventKey === 'READ_FAILING')?.severity).toBe('SEV2')
  })
})

describe('isReadDataUsableForRecommendation（§10.5 staleガード）', () => {
  it('24時間超のstaleデータはAI価格推奨の入力に使わない', () => {
    expect(isReadDataUsableForRecommendation(new Date(now.getTime() - 25 * HOUR), now)).toBe(false)
    expect(isReadDataUsableForRecommendation(new Date(now.getTime() - HOUR), now)).toBe(true)
    expect(isReadDataUsableForRecommendation(null, now)).toBe(false)
  })
})
