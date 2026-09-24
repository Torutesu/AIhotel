import { describe, it, expect, vi } from 'vitest'
import { createRakutenTravelSource, parseRakutenHotelNo, parseVacantHotelResponse } from './rakutenTravel.js'

// 楽天トラベルの空室検索 API（#9 段階C）。実際の API には繋がず、公開仕様の形のレスポンスで確かめる

const plan = (withBreakfastFlag: number, withDinnerFlag: number, total: number) => ({
  roomInfo: [{ roomBasicInfo: { withBreakfastFlag, withDinnerFlag, planName: 'p' } }, { dailyCharge: { total, chargeFlag: 1 } }],
})

describe('parseRakutenHotelNo', () => {
  it('施設ページの URL から施設番号を取り出す', () => {
    expect(parseRakutenHotelNo('https://travel.rakuten.co.jp/HOTEL/12345/12345.html')).toBe('12345')
    expect(parseRakutenHotelNo('https://travel.rakuten.co.jp/HOTEL/678/')).toBe('678')
    expect(parseRakutenHotelNo('https://www.jalan.net/yad123/')).toBeNull()
  })
})

describe('parseVacantHotelResponse', () => {
  it('formatVersion 2（hotels[][]）と 1（hotels[].hotel[]）を読み、素泊まりかどうかを判定する', () => {
    const v2 = { hotels: [[{ hotelBasicInfo: { hotelNo: 1 } }, plan(0, 0, 9000), plan(1, 0, 11000)]] }
    expect(parseVacantHotelResponse(v2, 1)).toEqual([
      { hotelNo: '1', price: 9000, roomOnly: true },
      { hotelNo: '1', price: 11000, roomOnly: false },
    ])
    const v1 = { hotels: [{ hotel: [{ hotelBasicInfo: { hotelNo: 2 } }, plan(0, 0, 8000)] }] }
    expect(parseVacantHotelResponse(v1, 1)).toEqual([{ hotelNo: '2', price: 8000, roomOnly: true }])
  })

  it('total が無ければ1人あたりの料金×人数で1室の料金にする', () => {
    const body = {
      hotels: [[
        { hotelBasicInfo: { hotelNo: 3 } },
        { roomInfo: [{ roomBasicInfo: { withBreakfastFlag: 0, withDinnerFlag: 0 } }, { dailyCharge: { rakutenCharge: 5000, chargeFlag: 0 } }] },
      ]],
    }
    expect(parseVacantHotelResponse(body, 2)).toEqual([{ hotelNo: '3', price: 10000, roomOnly: true }])
  })
})

describe('createRakutenTravelSource', () => {
  function response(status: number, body: unknown) {
    return { status, ok: status >= 200 && status < 300, statusText: '', json: async () => body } as Response
  }

  it('施設をまとめて問い合わせ、素泊まりの最安値を人数ごとに返す。空室が無ければ満室', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const params = new URL(url).searchParams
      const adultNum = Number(params.get('adultNum'))
      if (adultNum === 3) return response(404, { error: 'not_found' })
      return response(200, {
        hotels: [[{ hotelBasicInfo: { hotelNo: 100 } }, plan(0, 0, 8000 * adultNum), plan(0, 0, 9000 * adultNum), plan(1, 1, 5000)]],
      })
    })
    const source = createRakutenTravelSource({
      applicationId: 'app',
      endpoint: 'https://api.example.com/vacant',
      intervalMs: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    })
    const result = await source.fetchBatch!(
      [
        { competitorId: 'a', competitorName: 'A', url: 'https://travel.rakuten.co.jp/HOTEL/100/100.html' },
        { competitorId: 'b', competitorName: 'B', url: 'https://travel.rakuten.co.jp/HOTEL/200/' },
      ],
      ['2026-10-01']
    )
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    const first = new URL(fetchImpl.mock.calls[0][0]).searchParams
    expect(first.get('hotelNo')).toBe('100,200')
    expect(first.get('checkoutDate')).toBe('2026-10-02')
    expect(result.get('a')).toEqual([{ stayDate: '2026-10-01', price1P: 8000, price2P: 16000, price3P: null, soldOut: false }])
    expect(result.get('b')).toEqual([{ stayDate: '2026-10-01', price1P: null, price2P: null, price3P: null, soldOut: true }])
  })

  it('施設番号を読み取れない URL と API のエラーは例外にする（実行記録に失敗として残る）', async () => {
    const failing = createRakutenTravelSource({
      applicationId: 'app',
      endpoint: 'https://api.example.com/vacant',
      intervalMs: 1000,
      fetchImpl: (async () => response(429, { error: 'too_many_requests' })) as unknown as typeof fetch,
      sleep: async () => {},
    })
    await expect(
      failing.fetch({ competitorId: 'a', competitorName: 'A', url: 'https://example.com/x' }, ['2026-10-01'])
    ).rejects.toThrow('施設番号を読み取れません')
    await expect(
      failing.fetch({ competitorId: 'a', competitorName: 'A', url: 'https://travel.rakuten.co.jp/HOTEL/1/' }, ['2026-10-01'])
    ).rejects.toThrow('429')
  })

  it('メインのアプリ ID が無効なら予備に切り替える。上限超過（429）では切り替えない', async () => {
    const used: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      const id = new URL(url).searchParams.get('applicationId')!
      used.push(id)
      if (id === 'main') return response(400, { error: 'wrong_parameter', error_description: 'specify valid applicationId' })
      return response(404, { error: 'not_found' })
    })
    const source = createRakutenTravelSource({
      applicationId: 'main',
      backupApplicationIds: ['backup'],
      endpoint: 'https://api.example.com/vacant',
      intervalMs: 1000,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    })
    await source.fetch({ competitorId: 'a', competitorName: 'A', url: 'https://travel.rakuten.co.jp/HOTEL/1/' }, ['2026-10-01'])
    // 1回目だけメイン、以降は予備のまま
    expect(used).toEqual(['main', 'backup', 'backup', 'backup'])

    const limited = vi.fn(async () => response(429, { error: 'too_many_requests' }))
    const throttled = createRakutenTravelSource({
      applicationId: 'main',
      backupApplicationIds: ['backup'],
      endpoint: 'https://api.example.com/vacant',
      intervalMs: 1000,
      fetchImpl: limited as unknown as typeof fetch,
      sleep: async () => {},
    })
    await expect(
      throttled.fetch({ competitorId: 'a', competitorName: 'A', url: 'https://travel.rakuten.co.jp/HOTEL/1/' }, ['2026-10-01'])
    ).rejects.toThrow('429')
    expect(limited).toHaveBeenCalledTimes(1)
  })
})
