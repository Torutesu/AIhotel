import { describe, it, expect } from 'vitest'
import { checkWriteGuardrails, DEFAULT_GUARDRAILS } from './guardrails.js'
import type { SyncPriceRankItem } from '@hotel-revenue-system/shared/types'

const current = new Map<number, SyncPriceRankItem>([
  [1, { rank: 1, price1P: 10000, price2P: 16000, price3P: 21000, price4P: null }],
  [2, { rank: 2, price1P: 12000, price2P: 18000, price3P: null, price4P: null }],
])

describe('checkWriteGuardrails', () => {
  it('変動幅が±30%以内なら通す', () => {
    const result = checkWriteGuardrails(
      [{ rank: 1, price1P: 12000, price2P: 19000, price3P: 25000 }],
      current
    )
    expect(result.ok).toBe(true)
    expect(result.violations).toHaveLength(0)
  })

  it('変動幅が上限を超える書き込みをブロックする（価格ロジックの異常出力検出）', () => {
    // 10000 → 14000 は +40% で上限30%超え
    const result = checkWriteGuardrails([{ rank: 1, price1P: 14000, price2P: 16000 }], current)
    expect(result.ok).toBe(false)
    expect(result.violations[0]).toMatchObject({ rank: 1, field: 'price1P' })
  })

  it('現在値が無いランク（新規設定）は変動幅チェックをスキップする', () => {
    const result = checkWriteGuardrails([{ rank: 10, price1P: 50000, price2P: 80000 }], current)
    expect(result.ok).toBe(true)
  })

  it('ランク範囲外（41以上・0以下）を拒否する — 最大40段階（F-SET-02）', () => {
    const result = checkWriteGuardrails(
      [
        { rank: 41, price1P: 10000, price2P: 16000 },
        { rank: 0, price1P: 10000, price2P: 16000 },
      ],
      current
    )
    expect(result.ok).toBe(false)
    expect(result.violations).toHaveLength(2)
  })

  it('価格の桁誤り（上限超え）と非正値を拒否する', () => {
    const result = checkWriteGuardrails(
      [{ rank: 10, price1P: 100_000_000, price2P: -500 }],
      current
    )
    expect(result.ok).toBe(false)
    const fields = result.violations.map((v) => v.field)
    expect(fields).toContain('price1P')
    expect(fields).toContain('price2P')
  })

  it('同一ランクの重複と空の書き込みを拒否する', () => {
    expect(checkWriteGuardrails([], current).ok).toBe(false)
    const dup = checkWriteGuardrails(
      [
        { rank: 1, price1P: 10000, price2P: 16000 },
        { rank: 1, price1P: 10000, price2P: 16000 },
      ],
      current
    )
    expect(dup.ok).toBe(false)
  })

  it('項目数上限を超える一括書き込みを拒否する', () => {
    const items = Array.from({ length: DEFAULT_GUARDRAILS.maxItemsPerJob + 1 }, (_, i) => ({
      rank: (i % 40) + 1,
      price1P: 10000,
      price2P: 16000,
    }))
    const result = checkWriteGuardrails(items, new Map())
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.reason.includes('上限'))).toBe(true)
  })

  it('片側の人数料金がnullでも現在値と比較しない（null同士は違反にしない）', () => {
    const result = checkWriteGuardrails(
      [{ rank: 2, price1P: 12500, price2P: 18500, price3P: null, price4P: null }],
      current
    )
    expect(result.ok).toBe(true)
  })
})
