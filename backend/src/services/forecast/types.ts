// 需要予測インターフェース（F-DP-05）。
//
// 現在はルールベース実装（ruleBasedForecaster.ts）のみだが、将来 ML モデルに
// 差し替えられるよう、呼び出し側（forecastService.ts）はこのインターフェースの
// みに依存する。過去実績・イベント等の必要データは各実装が自分でサービス層
// （prisma）から取得する。

export type ForecastDemandLevel = 'A' | 'B' | 'C' | 'D' | 'E'

export interface ForecastInput {
  hotelId: string
  startDate: Date
  endDate: Date
  /**
   * いつ時点の予測とみなすか（省略時は今日）。
   * 過去日を指定すると、その時点で判明していた情報だけで予測する＝バックテストになる。
   * 実装はこれを必ず尊重すること。無視すると検証誤差だけが良く出て本番で外れる。
   */
  predictedAt?: Date
}

export interface DailyForecast {
  date: Date
  predictedOccupancy: number
  demandLevel: ForecastDemandLevel
  /** 推奨ランクの並び順（PriceRank.sortOrder）。グラフ・比較用の数値表現 */
  recommendedRank: number | null
  /** 推奨ランクコード（"65".."0" / "★1".."★5"）。表示・SC連携はこちらが正 */
  recommendedRankCode: string | null
  recommendedPrice: number | null
  confidence: number
  modelVersion: string
}

export interface DemandForecaster {
  name: string
  forecast(input: ForecastInput): Promise<DailyForecast[]>
}
