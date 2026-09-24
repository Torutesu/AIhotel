import { config } from '../../lib/config.js'
import { createRakutenTravelSource } from './rakutenTravel.js'
import type { CompetitorRateSource } from './types.js'

// 登録済みの取得元（#9）。
//
// - 楽天トラベル: 公式 API（空室検索）。RAKUTEN_APPLICATION_ID を設定したときだけ登録する。
//   RAKUTEN_BACKUP_APPLICATION_IDS はメインの ID が無効になったときの切り替え先
// - ほかのサイト（じゃらん・一休・Booking.com など）は未登録。画面の巡回で取るかどうかは各サイトの利用規約の確認後に決め、
//   1サイトずつ types.ts の約束に沿って実装してここに足す
// 登録が無い取得元の競合価格は CSV の取り込み（POST /imports/competitor-prices）で入れる。
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
]
