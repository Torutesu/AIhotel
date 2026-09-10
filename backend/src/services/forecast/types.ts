// 需要予測インターフェース（F-DP-05）。
//
// 予測実装（現在は rule-based-v2）は「需要」だけを返し、価格（ランク）は
// services/pricing/rankDecision.ts が戦略重み・競合・ガードレールで決める
// （docs/外部要因設計.md §2: 需要予測層と価格決定層の分離）。
// 将来 ML モデルに差し替える場合もこのインターフェースだけを実装すればよい。
import type { DemandModelResult } from './demandModel.js'

export type ForecastDemandLevel = 'A' | 'B' | 'C' | 'D' | 'E'

export interface ForecastInput {
  hotelId: string
  startDate: Date
  endDate: Date
  /** 基準日（この日に利用可能な情報だけで予測する）。省略時は今日 */
  asOfDate?: Date
  /** 係数の一時上書き（アブレーション・what-if 用。DB には保存しない） */
  coefficientOverrides?: Record<string, number>
}

export interface DailyForecast {
  date: Date
  predictedOccupancy: number
  demandLevel: ForecastDemandLevel
  /** 価格決定層を通す前の基準ランク（需要→線形写像）。価格決定層が最終値で上書きする */
  recommendedRank: number | null
  recommendedPrice: number | null
  confidence: number
  modelVersion: string
  /** v2: 要因分解・信頼区間・clamp前の需要。価格決定層と学習が使う */
  demand?: DemandModelResult
}

export interface DemandForecaster {
  name: string
  forecast(input: ForecastInput): Promise<DailyForecast[]>
}
