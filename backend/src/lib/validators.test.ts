import { describe, it, expect } from 'vitest'
import {
  loginSchema,
  registerSchema,
  createPriceRankSchema,
  updateStrategySchema,
  recomputeForecastSchema,
  MAX_FORECAST_RANGE_DAYS,
} from './validators.js'
import { addUtcDays, todayJst } from './date.js'

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

describe('recomputeForecastSchema (C-3)', () => {
  const hotelId = 'demo-hotel-001'
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  it('日付を省略した場合は受け入れる（既定値で再計算する）', () => {
    expect(recomputeForecastSchema.safeParse({ hotelId }).success).toBe(true)
  })

  it('開始日が今日（JST）なら受け入れる', () => {
    const result = recomputeForecastSchema.safeParse({ hotelId, startDate: iso(todayJst()) })
    expect(result.success).toBe(true)
  })

  it('過去日を開始日に指定すると拒否する', () => {
    const result = recomputeForecastSchema.safeParse({
      hotelId,
      startDate: iso(addUtcDays(todayJst(), -1)),
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.errors[0].message).toContain('本日以降')
    }
  })

  it('開始日が終了日より後なら拒否する', () => {
    const start = addUtcDays(todayJst(), 10)
    const result = recomputeForecastSchema.safeParse({
      hotelId,
      startDate: iso(start),
      endDate: iso(addUtcDays(start, -1)),
    })
    expect(result.success).toBe(false)
  })

  it('期間がちょうど366日なら受け入れる', () => {
    const start = todayJst()
    const result = recomputeForecastSchema.safeParse({
      hotelId,
      startDate: iso(start),
      endDate: iso(addUtcDays(start, MAX_FORECAST_RANGE_DAYS - 1)),
    })
    expect(result.success).toBe(true)
  })

  it('期間が367日以上なら拒否する', () => {
    const start = todayJst()
    const result = recomputeForecastSchema.safeParse({
      hotelId,
      startDate: iso(start),
      endDate: iso(addUtcDays(start, MAX_FORECAST_RANGE_DAYS)),
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.errors[0].message).toContain(`${MAX_FORECAST_RANGE_DAYS}日`)
    }
  })

  it('開始日を省略して終了日だけ指定した場合は今日起点で期間を判定する', () => {
    const tooFar = addUtcDays(todayJst(), MAX_FORECAST_RANGE_DAYS)
    expect(recomputeForecastSchema.safeParse({ hotelId, endDate: iso(tooFar) }).success).toBe(false)
  })
})
