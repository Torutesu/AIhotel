// 天候シグナルの正規化型（docs/外部要因設計.md §3 #4）。
// 取得元（気象庁 / Open-Meteo）が違っても ExternalSignal.value にはこの形で保存する。

export interface WeatherSignalValue {
  /** 取得元固有の天気コード（気象庁: "203" 等、Open-Meteo: WMO 0〜99） */
  weatherCode: string
  /** 降水確率 0〜100（不明なら null） */
  rainProbability: number | null
  tempMax: number | null
  tempMin: number | null
  /** 気象庁週間予報の信頼度 A/B/C（Open-Meteo は null） */
  reliability: string | null
  /** 需要側で使う二値化: 主天気が雨/雪、または降水確率 60% 以上 */
  isRainy: boolean
}

export interface DailyWeather extends WeatherSignalValue {
  /** YYYY-MM-DD（JST の暦日） */
  date: string
}

export const RAINY_PROBABILITY_THRESHOLD = 60
