import { describe, it, expect } from 'vitest'
import {
  resolveOwnGuestPrices,
  type OwnRankPrices,
  type OwnRoomPriceRecord,
} from './dailyService.js'

describe('resolveOwnGuestPrices（自館の利用人数別価格 — #57）', () => {
  const rank: OwnRankPrices = { price1P: 20_000, price2P: 28_000, price3P: 36_000 }

  it('客室タイプ別の実績が無ければAI推奨ランクの人数別価格を使う', () => {
    const prices = resolveOwnGuestPrices([], rank)
    expect(prices).toEqual({ price1P: 20_000, price2P: 28_000, price3P: 36_000 })
  })

  it('1名・2名・3名でそれぞれ異なる価格になる（同じ値を返さない）', () => {
    const prices = resolveOwnGuestPrices([], rank)
    expect(prices.price1P).not.toBe(prices.price2P)
    expect(prices.price2P).not.toBe(prices.price3P)
  })

  it('客室タイプ別の実績があれば販売室数で加重平均する', () => {
    const roomData: OwnRoomPriceRecord[] = [
      { price1P: 10_000, price2P: 14_000, price3P: 18_000, soldRooms: 30 },
      { price1P: 20_000, price2P: 28_000, price3P: 36_000, soldRooms: 10 },
    ]
    // 1名: (10,000×30 + 20,000×10) / 40 = 12,500
    const prices = resolveOwnGuestPrices(roomData, rank)
    expect(prices.price1P).toBe(12_500)
    expect(prices.price2P).toBe(17_500)
    expect(prices.price3P).toBe(22_500)
  })

  it('販売室数が未入力のタイプは重み1（単純平均）として扱う', () => {
    const roomData: OwnRoomPriceRecord[] = [
      { price1P: 10_000, price2P: null, price3P: null, soldRooms: null },
      { price1P: 20_000, price2P: null, price3P: null, soldRooms: 0 },
    ]
    expect(resolveOwnGuestPrices(roomData, undefined).price1P).toBe(15_000)
  })

  it('実績が欠けている人数だけランクの価格で補う（人数ごとに独立して判定する）', () => {
    const roomData: OwnRoomPriceRecord[] = [
      { price1P: 12_000, price2P: null, price3P: null, soldRooms: 20 },
    ]
    const prices = resolveOwnGuestPrices(roomData, rank)
    expect(prices.price1P).toBe(12_000) // 実績を優先
    expect(prices.price2P).toBe(28_000) // 実績が無いのでランクから
    expect(prices.price3P).toBe(36_000)
  })

  it('実績もランクも無い人数は null（ADRや0で代用しない）', () => {
    expect(resolveOwnGuestPrices([], undefined)).toEqual({
      price1P: null,
      price2P: null,
      price3P: null,
    })
  })

  it('3名料金が未設定の料金ランクでは3名のみ null になる', () => {
    const prices = resolveOwnGuestPrices([], { price1P: 20_000, price2P: 28_000, price3P: null })
    expect(prices.price1P).toBe(20_000)
    expect(prices.price3P).toBeNull()
  })

  it('加重平均は整数に丸める', () => {
    const roomData: OwnRoomPriceRecord[] = [
      { price1P: 10_000, price2P: null, price3P: null, soldRooms: 1 },
      { price1P: 10_001, price2P: null, price3P: null, soldRooms: 2 },
    ]
    // (10,000 + 20,002) / 3 = 10,000.67 → 10,001
    expect(resolveOwnGuestPrices(roomData, undefined).price1P).toBe(10_001)
  })
})
