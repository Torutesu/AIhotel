import { describe, it, expect } from 'vitest'
import { evaluateImportFreshness } from './importHealth.js'

const now = new Date('2026-09-15T03:00:00.000Z')

describe('evaluateImportFreshness（無人運用の監視）', () => {
  it('一度も取り込まれていないホテルは never-imported（アラート対象にしない）', () => {
    const result = evaluateImportFreshness({ hasPreviousDayData: false, lastSuccessAt: null, now })
    expect(result.status).toBe('never-imported')
    expect(result.hoursSinceLastSuccess).toBeNull()
  })

  it('前日分が入っていれば ok', () => {
    const result = evaluateImportFreshness({
      hasPreviousDayData: true,
      lastSuccessAt: new Date('2026-09-15T00:00:00.000Z'),
      now,
    })
    expect(result.status).toBe('ok')
    expect(result.hoursSinceLastSuccess).toBe(3)
  })

  it('既定36時間を超えて成功が無ければ stale（端末やスケジューラの停止を疑う）', () => {
    const result = evaluateImportFreshness({
      hasPreviousDayData: true,
      lastSuccessAt: new Date('2026-09-13T12:00:00.000Z'),
      now,
    })
    expect(result.status).toBe('stale')
    expect(result.hoursSinceLastSuccess).toBe(39)
  })

  it('しきい値は呼び出し側で変えられる', () => {
    const input = {
      hasPreviousDayData: true,
      lastSuccessAt: new Date('2026-09-14T00:00:00.000Z'),
      now,
    }
    expect(evaluateImportFreshness(input).status).toBe('ok')
    expect(evaluateImportFreshness({ ...input, staleHours: 12 }).status).toBe('stale')
  })

  it('取込は動いているが前日分が無ければ missing-previous-day', () => {
    const result = evaluateImportFreshness({
      hasPreviousDayData: false,
      lastSuccessAt: new Date('2026-09-15T00:00:00.000Z'),
      now,
    })
    expect(result.status).toBe('missing-previous-day')
  })

  it('しきい値ちょうどは stale にしない（境界）', () => {
    const result = evaluateImportFreshness({
      hasPreviousDayData: true,
      lastSuccessAt: new Date('2026-09-13T15:00:00.000Z'),
      now,
      staleHours: 36,
    })
    expect(result.hoursSinceLastSuccess).toBe(36)
    expect(result.status).toBe('ok')
  })
})
