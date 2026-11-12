import { config } from '../../lib/config.js'
import { createRakutenTravelSource } from './rakutenTravel.js'
import type { CompetitorRateSource } from './types.js'
import { createScriptedSource, type SiteScript } from './crawler/scriptedSource.js'
import { logger } from '../../utils/logger.js'

// 登録済みの取得元（#9）。
//
// - 楽天トラベル: 公式 API（空室検索）。RAKUTEN_APPLICATION_ID を設定したときだけ登録する。
//   RAKUTEN_BACKUP_APPLICATION_IDS はメインの ID が無効になったときの切り替え先
// - ほかのサイト（じゃらん・一休・Booking.com など）は自前巡回（crawler/ — D-13）。各サイトの利用規約をクライアントが確認した後、
//   crawler/sites/<key>.ts に SiteScript を書いて CRAWL_SITE_SCRIPTS に登録し、CRAWL_ENABLED_SOURCES に足したものだけを動かす。
//   今は登録したサイトが無い（規約の確認待ち）
// 登録が無い取得元の競合価格は CSV の取り込み（POST /imports/competitor-prices）で入れる。
/** 自前巡回のサイト（規約の確認が済んで実装したもの）。今は無い */
export const CRAWL_SITE_SCRIPTS: SiteScript[] = []

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
