import { describe, it, expect } from 'vitest'
import { DEFAULT_OTA_CHANNELS, DEFAULT_REVIEW_SOURCES } from './tenantMasters.js'
import { updateRetentionSettingsSchema } from './validators.js'

describe('テナント別マスタの既定値（D-10）', () => {
  it('OTAチャネルのコードは重複しない', () => {
    const codes = DEFAULT_OTA_CHANNELS.map((c) => c.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('レビューソースのコードは重複しない', () => {
    const codes = DEFAULT_REVIEW_SOURCES.map((c) => c.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('既存データで使われている主要チャネルを含む', () => {
    // seed / 分析画面が使う語彙と一致していないと選択肢に出てこない
    const codes = DEFAULT_OTA_CHANNELS.map((c) => c.code)
    for (const expected of ['楽天トラベル', 'じゃらん', '一休', 'Expedia', 'Agoda', '公式']) {
      expect(codes).toContain(expected)
    }
  })
})

describe('データ保持期間の検証（D-06）', () => {
  it('通常の設定を受け付ける', () => {
    const result = updateRetentionSettingsSchema.safeParse({
      auditLogRetentionDays: 730,
      operationalDataRetentionDays: 365,
      dailyDataRetentionDays: null,
    })
    expect(result.success).toBe(true)
  })

  it('短すぎる監査ログ保持は拒否する', () => {
    expect(updateRetentionSettingsSchema.safeParse({ auditLogRetentionDays: 7 }).success).toBe(false)
  })

  it('日次実績は1年未満に設定できない（収益の元帳のため）', () => {
    expect(updateRetentionSettingsSchema.safeParse({ dailyDataRetentionDays: 90 }).success).toBe(false)
    expect(updateRetentionSettingsSchema.safeParse({ dailyDataRetentionDays: 365 }).success).toBe(true)
  })

  it('日次実績は null（無期限）を許す', () => {
    expect(updateRetentionSettingsSchema.safeParse({ dailyDataRetentionDays: null }).success).toBe(true)
  })
})
