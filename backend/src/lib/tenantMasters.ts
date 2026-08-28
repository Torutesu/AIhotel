// テナント別マスタの既定値（SAAS_DECISIONS.md D-10）。
//
// OTAチャネル・レビューソースは業界共通の語彙なので、テナント作成時にこの既定値を
// 自動投入する。初期設定の手間を増やさずに、独自チャネルを持つ顧客だけが
// 追加・編集できる状態にするのが狙い。
//
// code は実績テーブルの文字列（OtaChannelData.channel / ReviewScore.source）と一致させる。

export interface MasterSeed {
  code: string
  name: string
  sortOrder: number
}

/** OTAチャネルの既定値。実績データの channel 文字列と一致させること */
export const DEFAULT_OTA_CHANNELS: MasterSeed[] = [
  { code: '楽天トラベル', name: '楽天トラベル', sortOrder: 1 },
  { code: 'じゃらん', name: 'じゃらん', sortOrder: 2 },
  { code: '一休', name: '一休.com', sortOrder: 3 },
  { code: 'Expedia', name: 'Expedia', sortOrder: 4 },
  { code: 'Agoda', name: 'Agoda', sortOrder: 5 },
  { code: 'Booking.com', name: 'Booking.com', sortOrder: 6 },
  { code: '公式', name: '公式サイト', sortOrder: 7 },
]

/** レビューソースの既定値。ReviewScore.source と一致させること */
export const DEFAULT_REVIEW_SOURCES: MasterSeed[] = [
  { code: 'google', name: 'Google', sortOrder: 1 },
  { code: 'tripadvisor', name: 'トリップアドバイザー', sortOrder: 2 },
  { code: 'rakuten', name: '楽天トラベル', sortOrder: 3 },
  { code: 'jalan', name: 'じゃらん', sortOrder: 4 },
  { code: 'ikkyu', name: '一休.com', sortOrder: 5 },
]
