import { describe, it, expect } from 'vitest'
import {
  loginSchema,
  registerSchema,
  createPriceRankSchema,
  bulkUpsertPriceRanksSchema,
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
    roomTypeId: 'cljk1234500000000000efgh',
    rateCategory: 'OWN' as const,
    sortOrder: 10,
    price: 15200,
  }

  it('数値ランクコードを受け入れる（F-SET-02: 65〜0）', () => {
    expect(createPriceRankSchema.safeParse({ ...base, rankCode: '65' }).success).toBe(true)
    expect(createPriceRankSchema.safeParse({ ...base, rankCode: '0' }).success).toBe(true)
  })

  it('★付きランクコードを受け入れる（★1〜★5）', () => {
    expect(createPriceRankSchema.safeParse({ ...base, rankCode: '★1' }).success).toBe(true)
    expect(createPriceRankSchema.safeParse({ ...base, rankCode: '★5' }).success).toBe(true)
  })

  it('不正な形式のランクコードを拒否する', () => {
    expect(createPriceRankSchema.safeParse({ ...base, rankCode: 'R01' }).success).toBe(false)
    expect(createPriceRankSchema.safeParse({ ...base, rankCode: '' }).success).toBe(false)
  })

  it('100円単位でない価格を拒否する（機能リスト: 100円単位対応）', () => {
    expect(createPriceRankSchema.safeParse({ ...base, rankCode: '30', price: 15250 }).success).toBe(false)
    expect(createPriceRankSchema.safeParse({ ...base, rankCode: '30', price: 15200 }).success).toBe(true)
  })

  it('未知のレート区分を拒否する', () => {
    expect(
      createPriceRankSchema.safeParse({ ...base, rankCode: '30', rateCategory: 'UNKNOWN' }).success
    ).toBe(false)
  })
})

describe('bulkUpsertPriceRanksSchema', () => {
  it('料金表1系列の一括登録を受け入れる', () => {
    const result = bulkUpsertPriceRanksSchema.safeParse({
      hotelId: 'cljk1234500000000000abcd',
      roomTypeId: 'cljk1234500000000000efgh',
      rateCategory: 'OTA',
      items: [
        { rankCode: '65', sortOrder: 0, price: 16900 },
        { rankCode: '★5', sortOrder: 70, price: 74700 },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('空のitemsを拒否する', () => {
    const result = bulkUpsertPriceRanksSchema.safeParse({
      hotelId: 'cljk1234500000000000abcd',
      roomTypeId: 'cljk1234500000000000efgh',
      rateCategory: 'OTA',
      items: [],
    })
    expect(result.success).toBe(false)
  })
})
