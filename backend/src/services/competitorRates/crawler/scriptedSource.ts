import { config } from '../../../lib/config.js'
import { logger } from '../../../utils/logger.js'
import type { CompetitorPriceSourceKey, CompetitorRateSource, FetchTarget, FetchedRate } from '../types.js'
import { PoliteFetcher, RobotsDisallowedError } from './politeFetcher.js'
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
}

export interface SiteScript {
  key: CompetitorPriceSourceKey
  /** http = HTML をそのまま取る（既定）、browser = 描画してから読む（Playwright を入れたイメージだけ） */
  mode?: 'http' | 'browser'
  /** 競合の URL（設定タブで登録したもの）と宿泊日から、取りに行く URL を作る */
  buildRequests(target: FetchTarget, stayDates: string[]): SiteRequest[]
  /** 取った HTML から、その URL で分かる宿泊日の料金を読む。読めなければ例外（ページの構造が変わった） */
  parse(html: string, request: SiteRequest): FetchedRate[]
}

export function createScriptedSource(
  script: SiteScript,
  fetcher: Pick<PoliteFetcher, 'getText' | 'permit'> = new PoliteFetcher({
    userAgent: config.EXTERNAL_FETCH_USER_AGENT,
    minIntervalMs: config.CRAWL_MIN_INTERVAL_MS,
  })
): CompetitorRateSource {
  return {
    key: script.key,
    async fetch(target, stayDates) {
      const limited = stayDates.slice(0, CRAWL_MAX_DAYS_AHEAD)
      const requests = script.buildRequests(target, limited)
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
            rates.push(...script.parse(html, req).filter((r) => limited.includes(r.stayDate)))
          } catch (error) {
            // robots.txt の禁止は設定の問題なので、続けずに止める（同じサイトの他の URL もたぶん禁止）
            if (error instanceof RobotsDisallowedError) throw error
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
      return rates
    },
  }
}
