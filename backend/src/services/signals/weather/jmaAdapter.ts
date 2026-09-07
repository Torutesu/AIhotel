// 気象庁 防災情報（bosai）の予報 JSON アダプタ。
//
// エンドポイント: https://www.jma.go.jp/bosai/forecast/data/forecast/{officeCode}.json
//   - 認証・APIキー不要。公式に案内された API ではないが、気象庁サイト自身が
//     この JSON を読んで描画しており、利用条件は気象庁ホームページの利用規約
//     （出典明記で利用可、CC BY 4.0 互換）に従う
//   - 1日数回更新（5時/11時/17時ごろ）。日次ジョブで取れば十分
//   - レスポンスは長さ2の配列:
//       [0] 今日〜明後日の詳細（timeSeries[0]: 天気コード/日、[1]: 6時間ごとの降水確率、[2]: 気温）
//       [1] 週間予報（timeSeries[0]: 天気コード・降水確率・信頼度/日、[1]: 最高最低気温/日）
//   - 地域コード: https://www.jma.go.jp/bosai/common/const/area.json
//       offices（府県予報区 例 130000=東京都）→ class10s（一次細分区域 例 130010=東京地方）
//       週間予報側は一次細分区域が統合されることがある（例 伊豆諸島北部/南部 → 130100）ため、
//       areaCode が見つからなければ最初の区域にフォールバックし、その旨を返す
//   - 気温は AMeDAS 地点単位（例 44132=東京）。ホテル設定には持たせず、先頭地点を代表値とする
//
// 純粋関数 parseJmaForecast() と、fetch を行う fetchJmaForecast() を分離してテスト可能にする。
import { config } from '../../../lib/config.js'
import { RAINY_PROBABILITY_THRESHOLD, type DailyWeather } from './types.js'

interface JmaArea {
  area: { name: string; code: string }
  weatherCodes?: string[]
  weathers?: string[]
  pops?: string[]
  reliabilities?: string[]
  temps?: string[]
  tempsMax?: string[]
  tempsMin?: string[]
}

interface JmaTimeSeries {
  timeDefines: string[]
  areas: JmaArea[]
}

export interface JmaForecastPart {
  publishingOffice: string
  reportDatetime: string
  timeSeries: JmaTimeSeries[]
}

export type JmaForecastResponse = JmaForecastPart[]

export interface JmaParseResult {
  reportDatetime: string
  /** 要求した areaCode が見つからず先頭区域にフォールバックした場合はその区域コード */
  fallbackAreaCode: string | null
  days: DailyWeather[]
}

/** "2026-09-08T00:00:00+09:00" → "2026-09-08"（JST の暦日。UTC変換しない） */
function jstDate(timeDefine: string): string {
  return timeDefine.slice(0, 10)
}

function toNumber(v: string | undefined): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** 気象庁天気コードの百の位: 1=晴, 2=曇, 3=雨, 4=雪 */
export function isRainyJmaCode(code: string): boolean {
  return code.startsWith('3') || code.startsWith('4')
}

function pickArea(ts: JmaTimeSeries, areaCode: string): { area: JmaArea; fallback: boolean } | null {
  const exact = ts.areas.find((a) => a.area.code === areaCode)
  if (exact) return { area: exact, fallback: false }
  return ts.areas.length > 0 ? { area: ts.areas[0], fallback: true } : null
}

/**
 * 予報 JSON を日別の正規化レコードに変換する。
 * 短期（[0]）の天気コードと日別最大降水確率を優先し、週間（[1]）で残りの日を埋める。
 */
export function parseJmaForecast(response: JmaForecastResponse, areaCode: string): JmaParseResult {
  const byDate = new Map<string, DailyWeather>()
  let fallbackAreaCode: string | null = null

  const [shortTerm, weekly] = response
  if (!shortTerm) throw new Error('気象庁予報JSONの形式が想定と異なります（配列が空）')

  // ---- 週間予報（[1]）: 天気コード・降水確率・信頼度・気温
  if (weekly) {
    const wx = weekly.timeSeries[0]
    const picked = wx ? pickArea(wx, areaCode) : null
    if (wx && picked) {
      if (picked.fallback) fallbackAreaCode = picked.area.area.code
      wx.timeDefines.forEach((t, i) => {
        const code = picked.area.weatherCodes?.[i]
        if (!code) return
        const pop = toNumber(picked.area.pops?.[i])
        byDate.set(jstDate(t), {
          date: jstDate(t),
          weatherCode: code,
          rainProbability: pop,
          tempMax: null,
          tempMin: null,
          reliability: picked.area.reliabilities?.[i] || null,
          isRainy: isRainyJmaCode(code) || (pop != null && pop >= RAINY_PROBABILITY_THRESHOLD),
        })
      })
    }
    const temps = weekly.timeSeries[1]
    const station = temps?.areas[0]
    if (temps && station) {
      temps.timeDefines.forEach((t, i) => {
        const rec = byDate.get(jstDate(t))
        if (!rec) return
        rec.tempMax = toNumber(station.tempsMax?.[i])
        rec.tempMin = toNumber(station.tempsMin?.[i])
      })
    }
  }

  // ---- 短期予報（[0]）: より正確なので週間の値を上書きする
  const wxShort = shortTerm.timeSeries[0]
  const pickedShort = wxShort ? pickArea(wxShort, areaCode) : null
  if (wxShort && pickedShort) {
    if (pickedShort.fallback && !fallbackAreaCode) fallbackAreaCode = pickedShort.area.area.code
    // 6時間ごとの降水確率 → 日別最大値
    const popMaxByDate = new Map<string, number>()
    const popTs = shortTerm.timeSeries[1]
    const popArea = popTs ? pickArea(popTs, areaCode)?.area : undefined
    if (popTs && popArea) {
      popTs.timeDefines.forEach((t, i) => {
        const pop = toNumber(popArea.pops?.[i])
        if (pop == null) return
        const key = jstDate(t)
        popMaxByDate.set(key, Math.max(popMaxByDate.get(key) ?? 0, pop))
      })
    }
    wxShort.timeDefines.forEach((t, i) => {
      const code = pickedShort.area.weatherCodes?.[i]
      if (!code) return
      const key = jstDate(t)
      const existing = byDate.get(key)
      const pop = popMaxByDate.get(key) ?? existing?.rainProbability ?? null
      byDate.set(key, {
        date: key,
        weatherCode: code,
        rainProbability: pop,
        tempMax: existing?.tempMax ?? null,
        tempMin: existing?.tempMin ?? null,
        reliability: existing?.reliability ?? null,
        isRainy: isRainyJmaCode(code) || (pop != null && pop >= RAINY_PROBABILITY_THRESHOLD),
      })
    })
    // 短期予報の気温: timeDefines が "T00:00"（その日の最低）/"T09:00"（その日の最高）の対で並ぶ。
    // 週間側は初日の気温が空欄になるため、短期側で埋める
    const tempTs = shortTerm.timeSeries[2]
    const tempStation = tempTs?.areas[0]
    if (tempTs && tempStation) {
      tempTs.timeDefines.forEach((t, i) => {
        const rec = byDate.get(jstDate(t))
        const v = toNumber(tempStation.temps?.[i])
        if (!rec || v == null) return
        const hour = t.slice(11, 13)
        if (hour === '00' && rec.tempMin == null) rec.tempMin = v
        if (hour === '09' && rec.tempMax == null) rec.tempMax = v
      })
    }
  }

  return {
    reportDatetime: shortTerm.reportDatetime,
    fallbackAreaCode,
    days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
  }
}

/**
 * 気象庁から府県予報区の予報 JSON を取得する
 */
export async function fetchJmaForecast(officeCode: string): Promise<JmaForecastResponse> {
  if (!/^\d{6}$/.test(officeCode)) throw new Error(`気象庁の府県予報区コードが不正です: ${officeCode}`)
  const url = `${config.JMA_FORECAST_BASE_URL}/${officeCode}.json`
  const res = await fetch(url, {
    signal: AbortSignal.timeout(config.EXTERNAL_API_TIMEOUT_MS),
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`気象庁予報の取得に失敗しました: HTTP ${res.status} (${url})`)
  return (await res.json()) as JmaForecastResponse
}
