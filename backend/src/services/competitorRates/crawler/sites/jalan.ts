import type { FetchedRate } from '../../types.js'
import type { SiteRequest, SiteScript } from '../scriptedSource.js'

// じゃらん（D-13）。宿のプラン一覧（/yad<番号>/plan/）を、宿泊日・人数を指定して読む（料金は HTML に入っている。Shift_JIS）。
// 2026-11-12 に robots.txt（/yad…/plan/ は禁止されていない）と実際のページの構造を確かめ、__fixtures__/jalan-plan.html に保存した。
// 取り方（types.ts の統一基準）: 1室あたり（「合計(税込)」— 指定人数1泊の合計）の最安。素泊まりのプランがあればその中の最安、
// 無ければ全プランの最安（朝食付きしか売っていない宿もあるため）。取り消し線の料金（割引前）は使わない。

const BASE = 'https://www.jalan.net'
const pad = (n: number) => String(n).padStart(2, '0')

/** 登録した URL（例 https://www.jalan.net/yad379411/ ）から宿の番号を取る */
export function jalanHotelNo(url: string): string | null {
  return url.match(/jalan\.net\/yad(\d+)/)?.[1] ?? null
}

export function jalanPlanUrl(hotelNo: string, stayDate: string, occupancy: number): string {
  const [y, m, d] = stayDate.split('-').map(Number)
  const q = new URLSearchParams({
    stayYear: String(y),
    stayMonth: pad(m),
    stayDay: pad(d),
    stayCount: '1',
    roomCount: '1',
    adultNum: String(occupancy),
  })
  return `${BASE}/yad${hotelNo}/plan/?${q.toString()}`
}

const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

interface JalanPlan {
  name: string
  total: number
}

/** プランの行（<tr class="js-searchYadoRoomPlanCd …">）ごとに、プラン名と合計（取り消し線でないもの）を読む */
export function parseJalanPlans(html: string): JalanPlan[] {
  const starts = [...html.matchAll(/<tr class="js-searchYadoRoomPlanCd/g)].map((m) => m.index as number)
  const plans: JalanPlan[] = []
  starts.forEach((start, i) => {
    const row = html.slice(start, starts[i + 1] ?? html.indexOf('</tbody>', start))
    const name = textOf(row.match(/class="p-searchResultItem__planName jsc-planDetailLink"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? '')
    const cell = row.slice(row.indexOf('p-searchResultItem__totalCell'))
    const prices = [...cell.matchAll(/<span class="p-searchResultItem__total( [^"]*)?">([\s\S]*?)<\/span>/g)]
      .filter((m) => !(m[1] ?? '').includes('line-through'))
      .map((m) => Number(textOf(m[2]).replace(/[^\d]/g, '')))
      .filter((n) => Number.isFinite(n) && n > 0)
    if (name && prices.length > 0) plans.push({ name, total: Math.min(...prices) })
  })
  return plans
}

const ROOM_ONLY = /素泊|食事なし|食事無し/
const NO_VACANCY = /空室がありません|該当するプランがありません|ご指定の条件に該当する(プラン|宿)はありません|満室/

export const jalanScript: SiteScript = {
  key: 'jalan',
  buildRequests(target, stayDates, occupancies): SiteRequest[] {
    const hotelNo = jalanHotelNo(target.url)
    if (!hotelNo) throw new Error(`じゃらんの URL から宿の番号を読めません（例 https://www.jalan.net/yad123456/）: ${target.url}`)
    return stayDates.flatMap((stayDate) =>
      occupancies.map((occupancy) => ({ url: jalanPlanUrl(hotelNo, stayDate, occupancy), stayDates: [stayDate], occupancy }))
    )
  },
  parse(html, request): FetchedRate[] {
    const stayDate = request.stayDates[0]
    const plans = parseJalanPlans(html)
    const empty: FetchedRate = { stayDate, price1P: null, price2P: null, price3P: null, soldOut: false }
    if (plans.length === 0) {
      if (NO_VACANCY.test(textOf(html))) return [{ ...empty, soldOut: true }]
      throw new Error('じゃらんのプランを読めませんでした（ページの構造が変わった可能性）')
    }
    const roomOnly = plans.filter((p) => ROOM_ONLY.test(p.name))
    const price = Math.min(...(roomOnly.length > 0 ? roomOnly : plans).map((p) => p.total))
    const key = `price${request.occupancy}P` as const
    return [{ ...empty, [key]: price }]
  },
}
