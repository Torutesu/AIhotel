import { describe, it, expect } from 'vitest'
import {
  roomTypeRowSchema,
  budgetRowSchema,
  dailyDataRowSchema,
} from './importService.js'

// CSVの列をヘッダーごと省略した場合、parseCsvWithHeader はそのキー自体を作らない
// （values[key] === undefined）。任意列は undefined でも通ること（レビュー指摘1の再発防止）

describe('roomTypeRowSchema', () => {
  it('任意列 sortOrder をヘッダーごと省略しても通る', () => {
    const result = roomTypeRowSchema.safeParse({
      code: 'STD_SINGLE',
      name: 'スタンダードシングル',
      capacity: '1',
      count: '80',
      // sortOrder キーなし（列省略）
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.sortOrder).toBeUndefined()
  })

  it('空セル（空文字）も未入力として通る', () => {
    const result = roomTypeRowSchema.safeParse({
      code: 'STD_SINGLE',
      name: 'シングル',
      capacity: '1',
      count: '80',
      sortOrder: '',
    })
    expect(result.success).toBe(true)
  })

  it('数値でない値はエラーになる', () => {
    const result = roomTypeRowSchema.safeParse({
      code: 'STD_SINGLE',
      name: 'シングル',
      capacity: 'abc',
      count: '80',
    })
    expect(result.success).toBe(false)
  })
})

describe('budgetRowSchema', () => {
  it('year/month のみ（金額系の列をすべて省略）でも通る', () => {
    const result = budgetRowSchema.safeParse({ year: '2026', month: '9' })
    expect(result.success).toBe(true)
  })

  it('稼働率が1を超えるとエラーになる', () => {
    const result = budgetRowSchema.safeParse({ year: '2026', month: '9', budgetOccupancy: '78' })
    expect(result.success).toBe(false)
  })
})

describe('dailyDataRowSchema', () => {
  it('date のみ（他の列をすべて省略）でも通る', () => {
    const result = dailyDataRowSchema.safeParse({ date: '2026-08-01' })
    expect(result.success).toBe(true)
  })

  it('YYYY/MM/DD 形式も受け付けてUTC日付に正規化する', () => {
    const result = dailyDataRowSchema.safeParse({ date: '2026/08/01', occupancy: '0.78' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.date.toISOString()).toBe('2026-08-01T00:00:00.000Z')
  })

  it('存在しない日付はエラーになる', () => {
    const result = dailyDataRowSchema.safeParse({ date: '2026-02-30' })
    expect(result.success).toBe(false)
  })
})
