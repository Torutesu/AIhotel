// Open-Meteo 予報 API アダプタ（8〜16日先の補完用。docs/外部要因設計.md §3 #4）。
//
// エンドポイント:
//   非商用（無料・キー不要）: https://api.open-meteo.com/v1/forecast
//   商用（要 API キー）:      https://customer-api.open-meteo.com/v1/forecast?apikey=...
//   SaaS として提供する場合は商用プランが必要なため、OPEN_METEO_API_KEY 未設定時は
//   WEATHER_OPEN_METEO_ENABLED=true でも取得しない（デフォルト無効）。
// パラメータ: latitude, longitude, daily=weather_code,temperature_2m_max,temperature_2m_min,
//            precipitation_probability_max, forecast_days=16, timezone=Asia/Tokyo
// weather_code は WMO コード: 0 快晴, 1-3 曇, 45/48 霧, 51-67 霧雨/雨, 71-77 雪, 80-82 にわか雨,
//   85-86 にわか雪, 95-99 雷雨
import { config } from '../../../lib/config.js'
import { RAINY_PROBABILITY_THRESHOLD, type DailyWeather } from './types.js'

export interface OpenMeteoResponse {
  daily: {
    time: string[]
    weather_code: (number | null)[]
    temperature_2m_max: (number | null)[]
    temperature_2m_min: (number | null)[]
    precipitation_probability_max: (number | null)[]
  }
}

export function isRainyWmoCode(code: number): boolean {
  return code >= 51
}

export function parseOpenMeteoForecast(response: OpenMeteoResponse): DailyWeather[] {
  const d = response.daily
  return d.time.map((date, i) => {
    const code = d.weather_code[i]
    const pop = d.precipitation_probability_max[i] ?? null
    return {
      date,
      weatherCode: code == null ? '' : String(code),
      rainProbability: pop,
      tempMax: d.temperature_2m_max[i] ?? null,
      tempMin: d.temperature_2m_min[i] ?? null,
      reliability: null,
      isRainy: (code != null && isRainyWmoCode(code)) || (pop != null && pop >= RAINY_PROBABILITY_THRESHOLD),
    }
  })
}

export function isOpenMeteoAvailable(): boolean {
  return config.WEATHER_OPEN_METEO_ENABLED && !!config.OPEN_METEO_API_KEY
}

export async function fetchOpenMeteoForecast(latitude: number, longitude: number): Promise<OpenMeteoResponse> {
  if (!isOpenMeteoAvailable()) throw new Error('Open-Meteo は無効です（WEATHER_OPEN_METEO_ENABLED と OPEN_METEO_API_KEY を設定してください）')
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    forecast_days: '16',
    timezone: 'Asia/Tokyo',
    apikey: config.OPEN_METEO_API_KEY!,
  })
  const url = `${config.OPEN_METEO_BASE_URL}/v1/forecast?${params.toString()}`
  const res = await fetch(url, { signal: AbortSignal.timeout(config.EXTERNAL_API_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Open-Meteo の取得に失敗しました: HTTP ${res.status}`)
  return (await res.json()) as OpenMeteoResponse
}
