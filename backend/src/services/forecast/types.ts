// 需要予測インターフェース（F-DP-05）。
//
// 現在はルールベース実装（ruleBasedForecaster.ts）のみだが、将来 ML モデルに
// 差し替えられるよう、呼び出し側（forecastService.ts）はこのインターフェースの
// みに依存する。過去実績・イベント等の必要データは各実装が自分でサービス層
// （prisma）から取得する。

import type { RationaleV1 } from './rationale.js'

export type ForecastDemandLevel = 'A' | 'B' | 'C' | 'D' | 'E'

export interface ForecastInput {
  hotelId: string
  startDate: Date
  endDate: Date
  /**
   * 試算用（保存しない日単位のシミュレーション — 2026-10）: 日のタイプで決まる優先モデルの代わりに使うモデル。
   * 省略時は日のタイプのモデル
   */
  modelOverride?: 'occupancy' | 'balanced' | 'adr'
}

export interface DailyForecast {
  date: Date
  predictedOccupancy: number
  demandLevel: ForecastDemandLevel
  recommendedRank: number | null
  recommendedPrice: number | null
  /** 予測ADR（#77）。ADR実績が無いホテルでは null */
  predictedAdr: number | null
  confidence: number
  modelVersion: string
  /** 推奨理由（#24 E4）。推奨ランクを出さない予測実装では省略してよい */
  rationale?: RationaleV1
}

export interface DemandForecaster {
  name: string
  forecast(input: ForecastInput): Promise<DailyForecast[]>
}
