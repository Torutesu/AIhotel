import { describe, it, expect } from 'vitest'
import {
  loginSchema,
  registerSchema,
  createPriceRankSchema,
  updateStrategySchema,
} from './validators.js'

describe('loginSchema', () => {
  it('有効なメールアドレスと空でないパスワードを受け入れる', () => {
    const result = loginSchema.safeParse({
      email: 'user@example.com',
      password: 'anything',
    })
    expect(result.success).toBe(true)
  })

  it('不正なメールアドレスを拒否する', () => {
    const result = loginSchema.safeParse({
      email: 'not-an-email',
      password: 'anything',
    })
    expect(result.success).toBe(false)
  })

  it('空のパスワードを拒否する', () => {
    const result = loginSchema.safeParse({
      email: 'user@example.com',
      password: '',
    })
    expect(result.success).toBe(false)
  })
})

describe('registerSchema', () => {
  const valid = {
    email: 'user@example.com',
    password: 'Password1',
    name: 'テストユーザー',
  }

  it('大文字・小文字・数字を含む8文字以上のパスワードを受け入れる', () => {
    const result = registerSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('8文字未満のパスワードを拒否する', () => {
    const result = registerSchema.safeParse({ ...valid, password: 'Pass1' })
    expect(result.success).toBe(false)
  })

  it('大文字を含まないパスワードを拒否する', () => {
    const result = registerSchema.safeParse({ ...valid, password: 'password1' })
    expect(result.success).toBe(false)
  })

  it('数字を含まないパスワードを拒否する', () => {
    const result = registerSchema.safeParse({ ...valid, password: 'Password' })
    expect(result.success).toBe(false)
  })

  it('名前が空の場合は拒否する', () => {
    const result = registerSchema.safeParse({ ...valid, name: '' })
    expect(result.success).toBe(false)
  })
})

describe('createPriceRankSchema', () => {
  const base = {
    hotelId: 'cljk1234500000000000abcd',
    label: 'A',
    price1P: 5000,
    price2P: 8000,
  }

  it('rank 40 以下は受け入れる（F-SET-02: 最大40段階）', () => {
    const result = createPriceRankSchema.safeParse({ ...base, rank: 40 })
    expect(result.success).toBe(true)
  })

  it('rank が40を超える場合は拒否する', () => {
    const result = createPriceRankSchema.safeParse({ ...base, rank: 41 })
    expect(result.success).toBe(false)
  })

  it('rank が1未満(0以下)の場合は拒否する', () => {
    const result = createPriceRankSchema.safeParse({ ...base, rank: 0 })
    expect(result.success).toBe(false)
  })
})

describe('updateStrategySchema', () => {
  const hotelId = 'cljk1234500000000000abcd'

  it('重み付けの合計が100の場合は受け入れる（F-DP-02）', () => {
    const result = updateStrategySchema.safeParse({
      hotelId,
      weightOccupancy: 40,
      weightAdr: 30,
      weightCompetitor: 30,
    })
    expect(result.success).toBe(true)
  })

  it('重み付けの合計が100でない場合は拒否する', () => {
    const result = updateStrategySchema.safeParse({
      hotelId,
      weightOccupancy: 40,
      weightAdr: 30,
      weightCompetitor: 20,
    })
    expect(result.success).toBe(false)
  })
})
