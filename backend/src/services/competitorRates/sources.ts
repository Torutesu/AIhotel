import { config } from '../../lib/config.js'
import { createRakutenTravelSource } from './rakutenTravel.js'
import type { CompetitorRateSource } from './types.js'
import { createScriptedSource, type SiteScript } from './crawler/scriptedSource.js'
import { jalanScript } from './crawler/sites/jalan.js'
import { agodaUrl, bookingUrl } from './crawler/sites/browserSites.js'
import { createLlmSiteScript } from './crawler/llmExtract.js'
import { createAgentClient } from '../externalSignals/agent/collect.js'
import { logger } from '../../utils/logger.js'

// 登録済みの取得元（#9）。
//
// - 楽天トラベル: 公式 API（空室検索）。RAKUTEN_APPLICATION_ID を設定したときだけ登録する。
//   RAKUTEN_BACKUP_APPLICATION_IDS はメインの ID が無効になったときの切り替え先
// - ほかのサイト（じゃらん・一休・Booking.com など）は自前巡回（crawler/ — D-13）。各サイトの利用規約をクライアントが確認した後、
//   crawler/sites/<key>.ts に SiteScript を書いて CRAWL_SITE_SCRIPTS に登録し、CRAWL_ENABLED_SOURCES に足したものだけを動かす。
//   - じゃらん: 手書きの読み取り（実際のページで確認済み — sites/jalan.ts）
//   - Booking.com・Agoda: ブラウザで描画して AI で読む（ANTHROPIC_API_KEY と Playwright の入ったイメージが要る。実際のページは未確認）
//   - 一休・Expedia・Trip.com: robots.txt が拒否・禁止しているため作らない
// 登録が無い取得元の競合価格は CSV の取り込み（POST /imports/competitor-prices）で入れる。
/** 自前巡回のサイト。CRAWL_ENABLED_SOURCES に並べたものだけが動く */
function siteScripts(): SiteScript[] {
  const scripts: SiteScript[] = [jalanScript]
  const client = createAgentClient()
  if (client) {
    scripts.push(
      createLlmSiteScript({ key: 'booking', siteName: 'Booking.com', buildUrl: bookingUrl, client }),
      createLlmSiteScript({ key: 'agoda', siteName: 'Agoda', buildUrl: agodaUrl, client })
    )
  }
  return scripts
}
export const CRAWL_SITE_SCRIPTS: SiteScript[] = siteScripts()

function crawlSources(): CompetitorRateSource[] {
  const enabled = new Set(config.CRAWL_ENABLED_SOURCES)
  for (const key of enabled) {
    if (!CRAWL_SITE_SCRIPTS.some((s) => s.key === key)) {
      logger.warn({ source: key }, 'CRAWL_ENABLED_SOURCES にありますが、取得処理が実装されていない取得元です（無視します）')
    }
  }
  return CRAWL_SITE_SCRIPTS.filter((s) => enabled.has(s.key) && s.key !== 'rakuten').map((s) => createScriptedSource(s))
}

export const competitorRateSources: CompetitorRateSource[] = [
  ...(config.RAKUTEN_APPLICATION_ID
    ? [
        createRakutenTravelSource({
          applicationId: config.RAKUTEN_APPLICATION_ID,
          backupApplicationIds: config.RAKUTEN_BACKUP_APPLICATION_IDS,
          endpoint: config.RAKUTEN_TRAVEL_API_URL,
          intervalMs: config.RAKUTEN_REQUEST_INTERVAL_MS,
        }),
      ]
    : []),
  ...crawlSources(),
]
