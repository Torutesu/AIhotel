import { describe, it, expect } from 'vitest'
import { generatePriceRankRows } from './provisioningService.js'
import { priceRankGenerationParamsSchema } from '../lib/validators.js'

const baseParams = {
  count: 40,
  minPrice1P: 6500,
  maxPrice1P: 30000,
  multiplier2P: 1.4,
  multiplier3P: 1.8,
  roundTo: 100,
}

describe('generatePriceRankRows', () => {
  it('指定段階数の行を rank=1 から連番で生成する', () => {
    const rows = generatePriceRankRows(baseParams)
    expect(rows).toHaveLength(40)
    expect(rows.map((r) => r.rank)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1))
  })

  it('ラベルは R01〜R40 形式（2桁ゼロ埋め）', () => {
    const rows = generatePriceRankRows(baseParams)
    expect(rows[0].label).toBe('R01')
    expect(rows[8].label).toBe('R09')
    expect(rows[39].label).toBe('R40')
  })

  it('両端のランクが下限・上限価格に一致する（線形補間）', () => {
    const rows = generatePriceRankRows(baseParams)
    expect(rows[0].price1P).toBe(6500)
    expect(rows[39].price1P).toBe(30000)
  })

  it('価格は単調非減少になる', () => {
    const rows = generatePriceRankRows(baseParams)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].price1P).toBeGreaterThanOrEqual(rows[i - 1].price1P)
    }
  })

  it('roundTo の単位に丸められる', () => {
    const rows = generatePriceRankRows({ ...baseParams, minPrice1P: 6543, maxPrice1P: 29876 })
    for (const row of rows) {
      expect(row.price1P % 100).toBe(0)
      expect(row.price2P % 100).toBe(0)
      expect(row.price3P % 100).toBe(0)
    }
  })

  it('2名・3名料金は倍率どおり（丸め後）', () => {
    const rows = generatePriceRankRows({ ...baseParams, count: 2, roundTo: 1 })
    expect(rows[0].price2P).toBe(Math.round(6500 * 1.4))
    expect(rows[0].price3P).toBe(Math.round(6500 * 1.8))
  })

  it('multiplier4P 指定時のみ price4P を生成する', () => {
    const without = generatePriceRankRows(baseParams)
    expect(without[0].price4P).toBeUndefined()

    const withM4 = generatePriceRankRows({ ...baseParams, multiplier4P: 2.2, roundTo: 1 })
    expect(withM4[0].price4P).toBe(Math.round(6500 * 2.2))
  })

  it('count=1 でもゼロ除算せず下限価格1件を返す', () => {
    const rows = generatePriceRankRows({ ...baseParams, count: 1 })
    expect(rows).toHaveLength(1)
    expect(rows[0].price1P).toBe(6500)
  })
})

describe('priceRankGenerationParamsSchema', () => {
  it('デフォルトは 40段階・倍率1.4/1.8・100円丸め', () => {
    const parsed = priceRankGenerationParamsSchema.parse({ minPrice1P: 6500, maxPrice1P: 30000 })
    expect(parsed).toMatchObject({ count: 40, multiplier2P: 1.4, multiplier3P: 1.8, roundTo: 100 })
  })

  it('下限 > 上限 は拒否する', () => {
    const result = priceRankGenerationParamsSchema.safeParse({ minPrice1P: 30000, maxPrice1P: 6500 })
    expect(result.success).toBe(false)
  })

  it('41段階以上は拒否する（F-SET-02）', () => {
    const result = priceRankGenerationParamsSchema.safeParse({
      count: 41,
      minPrice1P: 6500,
      maxPrice1P: 30000,
    })
    expect(result.success).toBe(false)
  })
})
