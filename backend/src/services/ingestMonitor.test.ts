import { describe, it, expect } from 'vitest'
import { evaluateFreshness, zonedTodayAt } from './ingestMonitorService.js'

// 取込の未着検知（F-ING-01 — 仕様書Ⅲ章3.4）
// 取得手段が何であれ「期待時刻までに届いたか」だけで判定する
const at = (hhmm: string) => new Date(`2026-08-11T${hhmm}:00+09:00`)

describe('evaluateFreshness', () => {
  const base = { expectedAt: '06:00', graceMinutes: 60 }

  it('本日の期待時刻以降に成功していれば OK', () => {
    const r = evaluateFreshness({
      ...base,
      now: at('09:00'),
      lastSuccessAt: at('06:30'),
      lastAttemptAt: at('06:30'),
      lastAttemptFailed: false,
    })
    expect(r.status).toBe('OK')
  })

  it('期待時刻＋猶予を過ぎていなければ WAITING（早すぎる警報を出さない）', () => {
    const r = evaluateFreshness({
      ...base,
      now: at('06:30'),
      lastSuccessAt: at('05:00'),
      lastAttemptAt: at('05:00'),
      lastAttemptFailed: false,
    })
    expect(r.status).toBe('WAITING')
  })

  it('猶予を過ぎても本日分が未着なら LATE', () => {
    const r = evaluateFreshness({
      ...base,
      now: at('08:00'),
      // 前日には成功しているが本日分が無い
      lastSuccessAt: new Date('2026-08-10T06:30:00+09:00'),
      lastAttemptAt: new Date('2026-08-10T06:30:00+09:00'),
      lastAttemptFailed: false,
    })
    expect(r.status).toBe('LATE')
  })

  it('一度も成功していなければ NEVER', () => {
    const r = evaluateFreshness({
      ...base,
      now: at('08:00'),
      lastSuccessAt: null,
      lastAttemptAt: null,
      lastAttemptFailed: false,
    })
    expect(r.status).toBe('NEVER')
  })

  it('本日の試行が失敗で終わっていれば、猶予内でも FAILED を先に知らせる', () => {
    const r = evaluateFreshness({
      ...base,
      now: at('06:20'),
      lastSuccessAt: new Date('2026-08-10T06:30:00+09:00'),
      lastAttemptAt: at('06:10'),
      lastAttemptFailed: true,
    })
    expect(r.status).toBe('FAILED')
  })

  it('猶予0分でも期待時刻ちょうどまでは WAITING', () => {
    const r = evaluateFreshness({
      expectedAt: '06:00',
      graceMinutes: 0,
      now: at('05:59'),
      lastSuccessAt: null,
      lastAttemptAt: null,
      lastAttemptFailed: false,
    })
    expect(r.status).toBe('WAITING')
  })
})

// 期待時刻は「ホテル現地時間」。サーバ（コンテナはUTC）のローカル時刻で
// 判定すると日付がずれて誤警報・見逃しが出るため、明示的に検証する。
describe('タイムゾーン', () => {
  it('現地日付の HH:MM をUTCの瞬間に正しく直す', () => {
    // 2026-08-12 06:00 JST = 2026-08-11 21:00 UTC
    const jst = zonedTodayAt(new Date('2026-08-11T22:00:00Z'), '06:00', 'Asia/Tokyo')
    expect(jst.toISOString()).toBe('2026-08-11T21:00:00.000Z')
  })

  it('夏時間のあるタイムゾーンでもオフセットを取り違えない', () => {
    // ニューヨークは8月はEDT(-04:00) → 06:00 EDT = 10:00 UTC
    expect(
      zonedTodayAt(new Date('2026-08-11T15:00:00Z'), '06:00', 'America/New_York').toISOString()
    ).toBe('2026-08-11T10:00:00.000Z')
    // 1月はEST(-05:00) → 06:00 EST = 11:00 UTC
    expect(
      zonedTodayAt(new Date('2026-01-11T15:00:00Z'), '06:00', 'America/New_York').toISOString()
    ).toBe('2026-01-11T11:00:00.000Z')
  })

  it('UTCサーバ上でも現地の当日分で判定する（前日分の成功をOKと誤認しない）', () => {
    // now = 2026-08-12 07:00 JST。現地の期待時刻は同日06:00。
    // 最終成功 2026-08-12 05:00 JST は期待時刻前なので本日分は未着。
    const r = evaluateFreshness({
      expectedAt: '06:00',
      timeZone: 'Asia/Tokyo',
      graceMinutes: 60,
      now: new Date('2026-08-11T22:00:00Z'),
      lastSuccessAt: new Date('2026-08-11T20:00:00Z'),
      lastAttemptAt: new Date('2026-08-11T20:00:00Z'),
      lastAttemptFailed: false,
    })
    expect(r.status).toBe('LATE')
    // 表示も現地時間（UTC表記で運用者を混乱させない）
    expect(r.message).toContain('2026-08-12 05:00')
  })

  it('timeZone未指定は Asia/Tokyo として扱う', () => {
    expect(zonedTodayAt(new Date('2026-08-11T22:00:00Z'), '06:00').toISOString()).toBe(
      zonedTodayAt(new Date('2026-08-11T22:00:00Z'), '06:00', 'Asia/Tokyo').toISOString()
    )
  })
})
