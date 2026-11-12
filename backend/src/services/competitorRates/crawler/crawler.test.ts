import { describe, expect, it } from 'vitest'
import { isAllowed, parseRobotsTxt, productToken } from './robots.js'
import { PoliteFetcher, RobotsDisallowedError } from './politeFetcher.js'
import { createScriptedSource, CRAWL_MAX_DAYS_AHEAD, type SiteScript } from './scriptedSource.js'

// 競合サイトの自前巡回の基盤（D-13）: robots.txt、間隔・再試行、決まった手順の取得元のひな形

const UA = 'RevSt-RevenueBot/1.0 (+https://example.com/bot)'

describe('robots.txt', () => {
  const text = `
User-agent: *
Disallow: /search
Allow: /search/public
Crawl-delay: 2

User-agent: RevSt-RevenueBot
Disallow: /private/
Disallow: /*.pdf$
`
  it('自分の名前のグループがあればそれを使い、無ければ * を使う', () => {
    expect(productToken(UA)).toBe('revst-revenuebot')
    const mine = parseRobotsTxt(text, UA)
    expect(isAllowed(mine, '/search?q=1')).toBe(true) // 自分のグループには /search の禁止が無い
    expect(isAllowed(mine, '/private/a')).toBe(false)
    expect(isAllowed(mine, '/docs/a.pdf')).toBe(false)
    expect(isAllowed(mine, '/docs/a.pdf?x=1')).toBe(true) // $ は末尾一致
    const other = parseRobotsTxt(text, 'OtherBot/1.0')
    expect(isAllowed(other, '/search?q=1')).toBe(false)
    expect(isAllowed(other, '/search/public/1')).toBe(true) // 長く一致した Allow が勝つ
    expect(other.crawlDelaySec).toBe(2)
  })
})

/** 時刻を進めるだけの時計（待った時間を記録する） */
function fakeClock() {
  let t = 0
  const waits: number[] = []
  return {
    now: () => t,
    sleep: async (ms: number) => {
      waits.push(ms)
      t += ms
    },
    waits,
  }
}

function fakeFetch(routes: Record<string, Array<{ status: number; body?: string; headers?: Record<string, string> }>>) {
  const calls: string[] = []
  const impl = (async (url: string | URL) => {
    const key = String(url)
    calls.push(key)
    const queue = routes[key]
    const next = queue?.length ? (queue.length > 1 ? queue.shift()! : queue[0]) : { status: 404 }
    return new Response(next.body ?? '', { status: next.status, headers: next.headers })
  }) as unknown as typeof fetch
  return { impl, calls }
}

describe('PoliteFetcher', () => {
  it('robots.txt で禁止されたパスは取りに行かず、Crawl-delay と最小間隔の長いほうをあける', async () => {
    const clock = fakeClock()
    const { impl, calls } = fakeFetch({
      'https://a.example/robots.txt': [{ status: 200, body: 'User-agent: *\nDisallow: /ng\nCrawl-delay: 10' }],
      'https://a.example/ok/1': [{ status: 200, body: 'one' }],
      'https://a.example/ok/2': [{ status: 200, body: 'two' }],
    })
    const f = new PoliteFetcher({ userAgent: UA, minIntervalMs: 5000, fetchImpl: impl, sleep: clock.sleep, now: clock.now })
    expect(await f.getText('https://a.example/ok/1')).toBe('one')
    expect(await f.getText('https://a.example/ok/2')).toBe('two')
    await expect(f.getText('https://a.example/ng/x')).rejects.toBeInstanceOf(RobotsDisallowedError)
    expect(calls.filter((c) => c.endsWith('robots.txt'))).toHaveLength(1) // キャッシュする
    expect(calls).not.toContain('https://a.example/ng/x')
    expect(clock.waits).toContain(10_000)
  })

  it('robots.txt が 5xx・取れないときはすべて禁止、404 はすべて許可', async () => {
    const clock = fakeClock()
    const { impl } = fakeFetch({
      'https://down.example/robots.txt': [{ status: 503 }],
      'https://none.example/x': [{ status: 200, body: 'ok' }],
    })
    const f = new PoliteFetcher({ userAgent: UA, minIntervalMs: 1000, fetchImpl: impl, sleep: clock.sleep, now: clock.now })
    await expect(f.getText('https://down.example/x')).rejects.toBeInstanceOf(RobotsDisallowedError)
    expect(await f.getText('https://none.example/x')).toBe('ok')
  })

  it('429 は Retry-After だけ待って再試行し、回数を超えたら例外', async () => {
    const clock = fakeClock()
    const { impl, calls } = fakeFetch({
      'https://b.example/p': [{ status: 429, headers: { 'retry-after': '3' } }, { status: 200, body: 'ok' }],
      'https://b.example/q': [{ status: 503 }],
    })
    const f = new PoliteFetcher({ userAgent: UA, minIntervalMs: 1000, fetchImpl: impl, sleep: clock.sleep, now: clock.now })
    expect(await f.getText('https://b.example/p')).toBe('ok')
    expect(clock.waits).toContain(3000)
    await expect(f.getText('https://b.example/q')).rejects.toThrow('HTTP 503')
    expect(calls.filter((c) => c === 'https://b.example/q')).toHaveLength(3) // 1回＋再試行2回
  })
})

describe('createScriptedSource', () => {
  const target = { competitorId: 'c1', competitorName: '競合A', url: 'https://site.example/hotel/1' }
  const script: SiteScript = {
    key: 'jalan',
    buildRequests: (t, dates) => dates.map((d) => ({ url: `${t.url}?date=${d}`, stayDates: [d] })),
    parse: (html, req) => {
      const price = Number(html.match(/price=(\d+)/)?.[1])
      if (!price) throw new Error('料金が見つかりません（ページの構造が変わった可能性）')
      return [{ stayDate: req.stayDates[0], price1P: null, price2P: price, price3P: null, soldOut: false }]
    },
  }
  const dates = Array.from({ length: 120 }, (_, i) => new Date(Date.UTC(2026, 11, 1 + i)).toISOString().slice(0, 10))

  it('90日先までだけを取り、一部の日の失敗は飛ばす', async () => {
    const requested: string[] = []
    const fetcher = {
      getText: async (url: string) => {
        requested.push(url)
        return url.endsWith('2026-12-02') ? '<html>メンテナンス中</html>' : 'price=18000'
      },
      permit: async () => {},
    }
    const rates = await createScriptedSource(script, fetcher).fetch(target, dates)
    expect(requested).toHaveLength(CRAWL_MAX_DAYS_AHEAD)
    expect(rates).toHaveLength(CRAWL_MAX_DAYS_AHEAD - 1)
    expect(rates[0]).toMatchObject({ stayDate: '2026-12-01', price2P: 18000 })
  })

  it('1日も取れなければ例外、robots.txt の禁止はすぐ止める', async () => {
    const broken = { getText: async () => '<html></html>', permit: async () => {} }
    await expect(createScriptedSource(script, broken).fetch(target, dates.slice(0, 3))).rejects.toThrow('1日も取れませんでした')
    let count = 0
    const forbidden = {
      getText: async (url: string) => {
        count++
        throw new RobotsDisallowedError(url)
      },
      permit: async () => {},
    }
    await expect(createScriptedSource(script, forbidden).fetch(target, dates.slice(0, 3))).rejects.toBeInstanceOf(RobotsDisallowedError)
    expect(count).toBe(1)
  })
})
