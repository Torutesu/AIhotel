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
}

export interface DailyForecast {
  date: Date
  predictedOccupancy: number
  demandLevel: ForecastDemandLevel
  recommendedRank: number | null
  recommendedPrice: number | null
  confidence: number
  modelVersion: string
}

export interface DemandForecaster {
  name: string
  forecast(input: ForecastInput): Promise<DailyForecast[]>
}
