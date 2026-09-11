import { describe, it, expect } from 'vitest'
import { maxOf, mean, median, minOf } from './stats.js'

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

  it('外れ値に引きずられない（平均との違い）', () => {
    const prices = [12000, 13000, 14000, 200000]
    expect(median(prices)).toBe(13500)
    expect(mean(prices)).toBe(59750)
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

describe('minOf / maxOf / mean (C-9)', () => {
  it('最小・最大を返す', () => {
    expect(minOf([12000, 15000, 30000])).toBe(12000)
    expect(maxOf([12000, 15000, 30000])).toBe(30000)
  })

  it('空配列はすべて null', () => {
    expect(minOf([])).toBeNull()
    expect(maxOf([])).toBeNull()
    expect(mean([])).toBeNull()
  })

  it('mean は四捨五入した整数を返す', () => {
    expect(mean([10000, 10001])).toBe(10001)
  })
})
