import { describe, expect, it } from 'vitest'
import { createLlmSiteScript, reducePage } from './llmExtract.js'
import { agodaUrl, bookingUrl } from './sites/browserSites.js'
import { SiteBlockedError } from './pageSignals.js'
import type { MessagesClient } from '../../externalSignals/agent/collect.js'

// AI で読む取得（D-13）: Claude には繋がず、決まった報告を返す偽のクライアントを使う

function fakeClient(report: Record<string, unknown>, calls: unknown[] = []): MessagesClient {
  return {
    create: (async (params: unknown) => {
      calls.push(params)
      return { model: 'claude-opus-5-5', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'report_rates', input: report }], usage: { input_tokens: 1, output_tokens: 1 } }
    }) as unknown as MessagesClient['create'],
  }
}

const target = { competitorId: 'c', competitorName: 'ホテルA', url: 'https://www.booking.com/hotel/jp/hotel-a.ja.html?aid=1' }
const req = (url: string) => ({ url, stayDates: ['2026-12-05'], occupancy: 2 as const })

describe('reducePage', () => {
  it('スクリプト・スタイルを除いて文字だけにし、長いページは料金の周りを残す', () => {
    expect(reducePage('<script>var x=1</script><p>スタンダード&nbsp;&yen;12,000</p>')).toBe('スタンダード ¥12,000')
    const long = `<p>${'あ'.repeat(30_000)}</p><p>ツイン 素泊まり 18,500円</p><p>${'い'.repeat(30_000)}</p>`
    const reduced = reducePage(long)
    expect(reduced.length).toBeLessThanOrEqual(24_000)
    expect(reduced).toContain('18,500円')
  })
})

describe('createLlmSiteScript', () => {
  it('登録した URL のクエリを付け直し、宿泊日・人数の URL を作る', () => {
    expect(bookingUrl(target, '2026-12-05', 2)).toBe(
      'https://www.booking.com/hotel/jp/hotel-a.ja.html?checkin=2026-12-05&checkout=2026-12-06&group_adults=2&group_children=0&no_rooms=1&selected_currency=JPY&lang=ja'
    )
    expect(agodaUrl({ ...target, url: 'https://www.agoda.com/ja-jp/hotel-a/hotel/tokyo-jp.html' }, '2026-12-05', 1)).toContain('checkIn=2026-12-05&los=1&adults=1')
    expect(() => bookingUrl({ ...target, url: 'https://example.com/x' }, '2026-12-05', 2)).toThrow()
  })

  it('素泊まりの最安を優先し、無ければ全体の最安。ページの文字は <page> で区切って渡す', async () => {
    const calls: Array<{ messages: Array<{ content: string }>; fallbacks: unknown }> = []
    const script = createLlmSiteScript({ key: 'booking', siteName: 'Booking.com', buildUrl: bookingUrl, client: fakeClient({ pageState: 'ok', roomOnlyMinPrice: 18500, anyMinPrice: 16000, note: '' }, calls) })
    const [request] = script.buildRequests(target, ['2026-12-05'], [2])
    expect(await script.parse('<p>料金</p>', request)).toEqual([{ stayDate: '2026-12-05', price1P: null, price2P: 18500, price3P: null, soldOut: false }])
    expect(calls[0].messages[0].content).toContain('ホテル: ホテルA')
    expect(calls[0].messages[0].content).toContain('<page>')
    expect(calls[0].fallbacks).toBe('default')
    const anyOnly = createLlmSiteScript({ key: 'booking', siteName: 'B', buildUrl: bookingUrl, client: fakeClient({ pageState: 'ok', roomOnlyMinPrice: null, anyMinPrice: 21000, note: '' }) })
    expect((await anyOnly.parse('', req('u')))[0].price2P).toBe(21000)
  })

  it('満室・ブロックの画面・別のページ・ありえない金額を見分ける', async () => {
    const make = (report: Record<string, unknown>) => createLlmSiteScript({ key: 'agoda', siteName: 'Agoda', buildUrl: agodaUrl, client: fakeClient(report) })
    expect((await make({ pageState: 'soldOut', roomOnlyMinPrice: null, anyMinPrice: null, note: '' }).parse('', req('u')))[0].soldOut).toBe(true)
    await expect(make({ pageState: 'blocked', roomOnlyMinPrice: null, anyMinPrice: null, note: 'CAPTCHA' }).parse('', req('u'))).rejects.toBeInstanceOf(SiteBlockedError)
    await expect(make({ pageState: 'unrelated', roomOnlyMinPrice: null, anyMinPrice: null, note: '別ホテル' }).parse('', req('u'))).rejects.toThrow('違うページ')
    await expect(make({ pageState: 'ok', roomOnlyMinPrice: 12, anyMinPrice: 99_999_999, note: '' }).parse('', req('u'))).rejects.toThrow('読み取れません')
  })
})
