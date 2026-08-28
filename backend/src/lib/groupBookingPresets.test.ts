import { describe, it, expect } from 'vitest'
import { GROUP_BOOKING_PRESETS, findGroupBookingPreset } from './groupBookingPresets.js'
import { revenueImpactRuleSchema } from './validators.js'

describe('団体客レベニュー影響ルール（D-09）', () => {
  it('プリセットのキーは重複しない', () => {
    const keys = GROUP_BOOKING_PRESETS.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('定義済みのプリセットを受け付ける', () => {
    const result = revenueImpactRuleSchema.safeParse({ presetKey: 'displacement' })
    expect(result.success).toBe(true)
  })

  it('未定義のプリセットは拒否する（自由記述を防ぐ）', () => {
    const result = revenueImpactRuleSchema.safeParse({ presetKey: 'なんとなく影響あり' })
    expect(result.success).toBe(false)
  })

  it('必須パラメータが欠けているとエラーになる', () => {
    const result = revenueImpactRuleSchema.safeParse({ presetKey: 'rate_protected' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.errors[0].message).toContain('最低料金')
    }
  })

  it('必須パラメータを与えれば通る', () => {
    const result = revenueImpactRuleSchema.safeParse({
      presetKey: 'rate_protected',
      params: { floorPrice: 18000 },
      note: '20名以上の団体のみ適用',
    })
    expect(result.success).toBe(true)
  })

  it('パラメータ不要のプリセットは params 省略で通る', () => {
    for (const preset of GROUP_BOOKING_PRESETS.filter((p) => p.params.length === 0)) {
      expect(revenueImpactRuleSchema.safeParse({ presetKey: preset.key }).success).toBe(true)
    }
  })

  it('キーからプリセットを引ける', () => {
    expect(findGroupBookingPreset('incremental')?.label).toBe('追加需要（押し出しなし）')
    expect(findGroupBookingPreset('unknown')).toBeUndefined()
  })
})
