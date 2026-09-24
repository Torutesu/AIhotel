// 競合価格の取得元（#9 段階B）。サイトごとの取得処理はこのインタフェースを実装して sources.ts に登録する。
//
// 取得条件の統一基準（#9 §2 — 2026-09-23）: 素泊まり・税込・1室あたり、人数ごとの最安プラン（部屋タイプは問わない）、
// 返金不可プランも含める。満室・販売停止の日は料金を null にして soldOut を true にする。
//
// 実装の約束:
// - アクセスは控えめに（1サイトあたり数秒おき、対象は90日先まで）。robots.txt を尊重する
// - 日次の定常取得は、毎回同じ結果になる決まった手順で行う（HTTP 取得＋解析、または Playwright の決まったスクリプト）。
//   PC Use（画面を見て操作するエージェント）は、取得手順の初期構築・壊れたときの修復案づくり・決まった手順で取れないサイトに限り、
//   コストと一致率を計測してから使う（#9 の決定）
// - 取れなかった日は例外を投げる（ジョブが実行記録に失敗として残す）。一部の日だけ取れなかった場合は、取れた日だけを返してよい

export type CompetitorPriceSourceKey =
  | 'rakuten'
  | 'jalan'
  | 'ikkyu'
  | 'expedia'
  | 'agoda'
  | 'booking'
  | 'tripcom'
  | 'official'

export interface FetchTarget {
  competitorId: string
  competitorName: string
  /** 設定タブで登録した、この取得元の URL（Competitor.otaUrls[key]） */
  url: string
}

export interface FetchedRate {
  /** YYYY-MM-DD */
  stayDate: string
  price1P: number | null
  price2P: number | null
  price3P: number | null
  soldOut: boolean
}

export interface CompetitorRateSource {
  key: CompetitorPriceSourceKey
  fetch(target: FetchTarget, stayDates: string[]): Promise<FetchedRate[]>
  /**
   * 1ホテルの競合をまとめて取る（任意）。API が複数施設を1回で返す取得元（楽天の空室検索など）は
   * これを実装するとリクエスト数を減らせる。実装があれば fetch より優先する。戻り値のキーは competitorId
   */
  fetchBatch?(targets: FetchTarget[], stayDates: string[]): Promise<Map<string, FetchedRate[]>>
}
