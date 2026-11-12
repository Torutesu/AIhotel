import { config } from '../../../lib/config.js'
import { logger } from '../../../utils/logger.js'
import type { CompetitorPriceSourceKey, CompetitorRateSource, FetchTarget, FetchedRate } from '../types.js'
import { PoliteFetcher, RobotsDisallowedError } from './politeFetcher.js'
import { SiteBlockedError } from './pageSignals.js'
import { selectCrawlDates } from './plan.js'
import { launchBrowser, type BrowserSession } from './browser.js'

// 決まった手順で競合サイトの料金を取る取得元のひな形（D-13 — 自前巡回の基盤）。
// サイトごとに書くのは「どの URL を取るか（buildRequests）」と「取った HTML から料金を読む（parse）」の2つだけにする。
// robots.txt・間隔・再試行・90日先までの制限・一部の日の失敗の扱いはここで共通にする。
//
// 1サイト足す手順（各サイトの利用規約をクライアントが確認した後 — docs/改善計画.md D-13）:
//   1. crawler/sites/<key>.ts に SiteScript を書く（実際のページを保存したものを __fixtures__ に置き、parse を単体テストで固定する）
//   2. sources.ts の CRAWL_SITE_SCRIPTS に登録する
//   3. 環境変数 CRAWL_ENABLED_SOURCES にキーを足す（足さなければ動かない）

/** 取りに行く宿泊日の上限（今日から何日先まで — types.ts の約束） */
export const CRAWL_MAX_DAYS_AHEAD = 90

export interface SiteRequest {
  url: string
  /** この URL で分かる宿泊日（1ページで複数日が分かるサイトは複数） */
  stayDates: string[]
  /** この URL の人数（1室あたり）。parse はこの人数の料金を返す */
  occupancy: 1 | 2 | 3
}

export interface SiteScript {
  key: CompetitorPriceSourceKey
  /** http = HTML をそのまま取る（既定）、browser = 描画してから読む（Playwright を入れたイメージだけ） */
  mode?: 'http' | 'browser'
  /** 競合の URL（設定タブで登録したもの）・宿泊日・人数から、取りに行く URL を作る */
  buildRequests(target: FetchTarget, stayDates: string[], occupancies: Array<1 | 2 | 3>): SiteRequest[]
  /** 取った HTML から、その URL で分かる宿泊日の料金を読む。読めなければ例外（ページの構造が変わった）。非同期でもよい（AI で読む取得） */
  parse(html: string, request: SiteRequest): FetchedRate[] | Promise<FetchedRate[]>
}

export interface ScriptedSourceOptions {
  /** 取る人数（CRAWL_OCCUPANCIES） */
  occupancies?: Array<1 | 2 | 3>
  /** この取得元が1回のジョブで送るリクエストの上限（CRAWL_MAX_REQUESTS_PER_RUN）。全ホテル・全競合で共有する */
  maxRequestsPerRun?: number
}

/** 同じ宿泊日の人数ごとの結果を1行にまとめる（満室はどの人数でも満室のときだけ） */
export function mergeRates(rates: FetchedRate[]): FetchedRate[] {
  const byDate = new Map<string, FetchedRate>()
  for (const r of rates) {
    const cur = byDate.get(r.stayDate)
    if (!cur) {
      byDate.set(r.stayDate, { ...r })
      continue
    }
    cur.price1P = cur.price1P ?? r.price1P
    cur.price2P = cur.price2P ?? r.price2P
    cur.price3P = cur.price3P ?? r.price3P
    cur.soldOut = cur.soldOut && r.soldOut
  }
  return [...byDate.values()].sort((a, b) => a.stayDate.localeCompare(b.stayDate))
}

export function createScriptedSource(
  script: SiteScript,
  fetcher: Pick<PoliteFetcher, 'getText' | 'permit'> = new PoliteFetcher({
    userAgent: config.EXTERNAL_FETCH_USER_AGENT,
    minIntervalMs: config.CRAWL_MIN_INTERVAL_MS,
    jitterRatio: config.CRAWL_JITTER_RATIO,
  }),
  options: ScriptedSourceOptions = {}
): CompetitorRateSource {
  const occupancies = options.occupancies ?? config.CRAWL_OCCUPANCIES
  let remaining = options.maxRequestsPerRun ?? config.CRAWL_MAX_REQUESTS_PER_RUN
  return {
    key: script.key,
    async fetch(target, stayDates) {
      // 90日先まで、遠い日ほど間引く（止められないための量の抑制）
      const limited = selectCrawlDates(stayDates.slice(0, CRAWL_MAX_DAYS_AHEAD))
      const all = script.buildRequests(target, limited, occupancies)
      // 1回のジョブの上限を超えた分は取らない（次の回に回す。近い日から並んでいるので近い日が優先される）
      const requests = all.slice(0, Math.max(0, remaining))
      remaining -= requests.length
      if (requests.length < all.length) {
        logger.warn({ source: script.key, competitor: target.competitorName, skipped: all.length - requests.length }, '1回の取得の上限に達したため、残りの日は次の回に取ります')
      }
      if (requests.length === 0) return []
      const rates: FetchedRate[] = []
      const errors: string[] = []
      let browser: BrowserSession | null = null
      if (script.mode === 'browser') {
        browser = await launchBrowser(config.EXTERNAL_FETCH_USER_AGENT)
        if (!browser) throw new Error(`${script.key}: ブラウザ（Playwright）が入っていないイメージでは取得できません`)
      }
      const read = async (url: string) => {
        if (!browser) return fetcher.getText(url)
        await fetcher.permit(url)
        const page = await browser.newPage()
        try {
          await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 })
          return await page.content()
        } finally {
          await page.close()
        }
      }
      try {
        for (const req of requests) {
          try {
            const html = await read(req.url)
            rates.push(...(await script.parse(html, req)).filter((r) => limited.includes(r.stayDate)))
          } catch (error) {
            // robots.txt の禁止・サイトに止められた兆候は、続けずにすぐやめる（続けるとブロックが強まる）
            if (error instanceof RobotsDisallowedError || error instanceof SiteBlockedError) {
              remaining = 0
              throw error
            }
            errors.push(error instanceof Error ? error.message : String(error))
          }
        }
      } finally {
        await browser?.close()
      }
      if (rates.length === 0 && requests.length > 0) {
        throw new Error(`${script.key}: ${target.competitorName} の料金を1日も取れませんでした（${errors[0] ?? '理由不明'}）`)
      }
      if (errors.length > 0) {
        logger.warn(
          {
            source: script.key,
            competitor: target.competitorName,
            failed: errors.length,
            sample: errors[0],
          },
          '一部の日の料金を取れませんでした'
        )
      }
      return mergeRates(rates)
    },
  }
}
