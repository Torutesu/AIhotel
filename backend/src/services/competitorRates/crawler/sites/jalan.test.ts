import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { jalanHotelNo, jalanPlanUrl, jalanScript, parseJalanPlans } from './jalan.js'

// じゃらんのプラン一覧（2026-11-12 に取得した実際のページの一部 — 素泊まり3件・朝食付き2件）
const html = readFileSync(new URL('./__fixtures__/jalan-plan.html', import.meta.url), 'utf8')

describe('じゃらん', () => {
  it('登録した URL から宿の番号を取り、宿泊日・人数のプラン一覧の URL を作る', () => {
    expect(jalanHotelNo('https://www.jalan.net/yad379411/')).toBe('379411')
    expect(jalanHotelNo('https://www.jalan.net/kankou/')).toBeNull()
    expect(jalanPlanUrl('379411', '2026-12-02', 2)).toBe(
      'https://www.jalan.net/yad379411/plan/?stayYear=2026&stayMonth=12&stayDay=02&stayCount=1&roomCount=1&adultNum=2'
    )
  })

  it('プランごとに、取り消し線でない合計（税込）を読む', () => {
    const plans = parseJalanPlans(html)
    expect(plans).toHaveLength(5)
    expect(plans[0]).toEqual({ name: '【素泊まり】ハリウッドツインルーム【セミダブルベッドが２台】', total: 45580 })
    expect(plans.map((p) => p.total)).toEqual([45580, 38920, 35620, 49380, 42720])
  })

  it('素泊まりの最安を、その人数の料金にする', async () => {
    const [rate] = await jalanScript.parse(html, { url: '', stayDates: ['2026-12-02'], occupancy: 2 })
    expect(rate).toEqual({ stayDate: '2026-12-02', price1P: null, price2P: 35620, price3P: null, soldOut: false })
  })

  it('プランが無く「空室がありません」なら満室、どちらでもなければ構造が変わったとして例外', () => {
    const req = { url: '', stayDates: ['2026-12-02'], occupancy: 2 as const }
    expect(jalanScript.parse('<html><p>ご指定の条件では空室がありません</p></html>', req)).toEqual([
      { stayDate: '2026-12-02', price1P: null, price2P: null, price3P: null, soldOut: true },
    ])
    expect(() => jalanScript.parse('<html><p>メンテナンス中</p></html>', req)).toThrow('構造が変わった')
  })

  it('宿の番号が読めない URL は例外', () => {
    expect(() => jalanScript.buildRequests({ competitorId: 'c', competitorName: 'x', url: 'https://www.jalan.net/' }, ['2026-12-02'], [2])).toThrow()
  })
})
