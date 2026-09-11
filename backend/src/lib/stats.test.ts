import { describe, it, expect } from 'vitest'
import { maxOf, median, minOf } from './stats.js'

describe('median (C-9)', () => {
  it('奇数個は中央の値', () => {
    expect(median([12000, 15000, 30000])).toBe(15000)
  })

  it('偶数個は中央2値の平均（四捨五入）', () => {
    expect(median([10000, 12000, 15000, 30000])).toBe(13500)
    expect(median([10000, 11001])).toBe(10501)
  })

  it('順不同でも正しく求まる', () => {
    expect(median([30000, 12000, 15000])).toBe(15000)
  })

  it('外れ値に引きずられない（単純平均なら59750になる並び）', () => {
    const prices = [12000, 13000, 14000, 200000]
    expect(median(prices)).toBe(13500)
  })

  it('入力配列を破壊しない', () => {
    const prices = [30000, 12000, 15000]
    median(prices)
    expect(prices).toEqual([30000, 12000, 15000])
  })

  it('空配列は null', () => {
    expect(median([])).toBeNull()
  })
})

describe('minOf / maxOf (C-9)', () => {
  it('最小・最大を返す', () => {
    expect(minOf([12000, 15000, 30000])).toBe(12000)
    expect(maxOf([12000, 15000, 30000])).toBe(30000)
  })

  it('空配列はすべて null', () => {
    expect(minOf([])).toBeNull()
    expect(maxOf([])).toBeNull()
  })
})
