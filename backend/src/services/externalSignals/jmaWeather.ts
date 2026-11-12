import { prisma } from '../../lib/prisma.js'
import { config } from '../../lib/config.js'
import { logger } from '../../utils/logger.js'
import { fetchWithTimeout } from './http.js'

// 天気（気象庁の予報 — D-13）。気象庁の Web サイトの予報 JSON（bosai/forecast/data/forecast/<府県予報区>.json）を使う。
// 気象庁のコンテンツは「政府標準利用規約」に準じて出典を明記すれば商用でも使える（API としての提供・保証は無い）。
// 1日1回、府県予報区ごとに1回だけ取り、その予報区のホテルに同じ値を保存する（短期予報で3日先、週間予報で7日先まで）。
// 先方の資料（外部要因と旅行の関連付け ②）のとおり、日々の天気は宿泊への効きが小さいので、日の背景の一つとして弱く使うだけにする。

export const JMA_ATTRIBUTION = '出典：気象庁ホームページ'

/** 都道府県コード（2桁）→ 府県予報区のコード。北海道・鹿児島・沖縄は地方ごとに分かれるので、道庁・県庁のある地方にする */
export function weatherAreaCodeForPrefecture(prefectureCode: string | null | undefined): string | null {
  if (!prefectureCode || !/^\d{2}$/.test(prefectureCode)) return null
  const n = Number(prefectureCode)
  if (n < 1 || n > 47) return null
  if (prefectureCode === '01') return '016000' // 石狩・空知・後志地方（札幌）
  if (prefectureCode === '46') return '460100' // 鹿児島県（奄美地方を除く）
  if (prefectureCode === '47') return '471000' // 沖縄本島地方
  return `${prefectureCode}0000`
}

export interface DailyWeather {
  /** YYYY-MM-DD（日本時間の日付） */
  date: string
  weatherCode: string
  weatherText: string | null
  pop: number | null
  tempMax: number | null
  tempMin: number | null
  reliability: string | null
}

export interface JmaForecastParsed {
  reportedAt: Date
  days: DailyWeather[]
}

interface JmaArea {
  area: { name: string; code: string }
  weatherCodes?: string[]
  weathers?: string[]
  pops?: string[]
  reliabilities?: string[]
  tempsMin?: string[]
  tempsMax?: string[]
}
interface JmaTimeSeries {
  timeDefines: string[]
  areas: JmaArea[]
}
interface JmaBlock {
  reportDatetime: string
  timeSeries: JmaTimeSeries[]
}

const toNumber = (v: string | undefined) => (v == null || v.trim() === '' ? null : Number(v))
const dateOf = (iso: string) => iso.slice(0, 10) // 予報の時刻は +09:00 付きなので先頭の10文字が日本時間の日付

/**
 * 予報 JSON を日ごとの天気にする。週間予報（2つ目）で7日分を作り、短期予報（1つ目）の重なる日は天気・降水確率を上書きする。
 * 各予報の先頭の地域（府県予報区の代表）を使う
 */
export function parseJmaForecast(json: unknown): JmaForecastParsed {
  if (!Array.isArray(json) || json.length === 0) throw new Error('気象庁の予報の形式が想定と違います（配列ではありません）')
  const blocks = json as JmaBlock[]
  const byDate = new Map<string, DailyWeather>()
  const ensure = (date: string): DailyWeather => {
    const existing = byDate.get(date)
    if (existing) return existing
    const created: DailyWeather = { date, weatherCode: '', weatherText: null, pop: null, tempMax: null, tempMin: null, reliability: null }
    byDate.set(date, created)
    return created
  }

  const weekly = blocks[1]
  if (weekly?.timeSeries?.length) {
    const [weather, temps] = weekly.timeSeries
    const area = weather?.areas?.[0]
    weather?.timeDefines.forEach((t, i) => {
      const code = area?.weatherCodes?.[i]
      if (!code) return
      const day = ensure(dateOf(t))
      day.weatherCode = code
      day.pop = toNumber(area?.pops?.[i])
      day.reliability = area?.reliabilities?.[i] || null
    })
    const tempArea = temps?.areas?.[0]
    temps?.timeDefines.forEach((t, i) => {
      const day = byDate.get(dateOf(t))
      if (!day) return
      day.tempMax = toNumber(tempArea?.tempsMax?.[i])
      day.tempMin = toNumber(tempArea?.tempsMin?.[i])
    })
  }

  const short = blocks[0]
  if (short?.timeSeries?.length) {
    const [weather, pops] = short.timeSeries
    const area = weather?.areas?.[0]
    weather?.timeDefines.forEach((t, i) => {
      const code = area?.weatherCodes?.[i]
      if (!code) return
      const day = ensure(dateOf(t))
      day.weatherCode = code
      day.weatherText = area?.weathers?.[i]?.replace(/　/g, ' ') ?? null
    })
    // 短期の降水確率は6時間ごと。その日の最大を使う
    const popArea = pops?.areas?.[0]
    const maxPop = new Map<string, number>()
    pops?.timeDefines.forEach((t, i) => {
      const v = toNumber(popArea?.pops?.[i])
      if (v == null) return
      const key = dateOf(t)
      maxPop.set(key, Math.max(maxPop.get(key) ?? 0, v))
    })
    for (const [date, pop] of maxPop) {
      const day = byDate.get(date)
      if (day) day.pop = pop
    }
  }

  const reported = blocks[0]?.reportDatetime ?? blocks[1]?.reportDatetime
  if (!reported) throw new Error('気象庁の予報に発表時刻がありません')
  return {
    reportedAt: new Date(reported),
    days: [...byDate.values()].filter((d) => d.weatherCode !== '').sort((a, b) => a.date.localeCompare(b.date)),
  }
}

export async function fetchJmaForecast(areaCode: string): Promise<JmaForecastParsed> {
  if (!/^\d{6}$/.test(areaCode)) throw new Error(`気象庁の予報区のコードが不正です: ${areaCode}`)
  const res = await fetchWithTimeout(`${config.JMA_FORECAST_URL}/${areaCode}.json`)
  if (!res.ok) throw new Error(`気象庁の予報を取得できませんでした（${areaCode}: HTTP ${res.status}）`)
  return parseJmaForecast(await res.json())
}

export interface WeatherRunResult {
  areas: number
  hotels: number
  days: number
  failedAreas: Array<{ areaCode: string; error: string }>
  /** 予報区を決められなかったホテル（都道府県も予報区も未設定） */
  skippedHotels: number
}

/**
 * 有効なホテルの天気を取り、宿泊日ごとに保存する（同じ日は最新の予報で上書き）。予報区ごとに1回だけ取得する
 */
export async function runWeatherForHotels(
  hotels: Array<{ id: string; tenantId: string; prefectureCode: string | null; weatherAreaCode: string | null }>,
  fetcher: (areaCode: string) => Promise<JmaForecastParsed> = fetchJmaForecast
): Promise<WeatherRunResult> {
  const byArea = new Map<string, typeof hotels>()
  let skippedHotels = 0
  for (const hotel of hotels) {
    const area = hotel.weatherAreaCode ?? weatherAreaCodeForPrefecture(hotel.prefectureCode)
    if (!area) {
      skippedHotels++
      continue
    }
    byArea.set(area, [...(byArea.get(area) ?? []), hotel])
  }

  const result: WeatherRunResult = { areas: 0, hotels: 0, days: 0, failedAreas: [], skippedHotels }
  for (const [areaCode, members] of byArea) {
    try {
      const forecast = await fetcher(areaCode)
      for (const hotel of members) {
        for (const day of forecast.days) {
          const date = new Date(`${day.date}T00:00:00Z`)
          const data = {
            areaCode,
            weatherCode: day.weatherCode,
            weatherText: day.weatherText,
            pop: day.pop,
            tempMax: day.tempMax,
            tempMin: day.tempMin,
            reliability: day.reliability,
            reportedAt: forecast.reportedAt,
          }
          await prisma.weatherForecast.upsert({
            where: { hotelId_date: { hotelId: hotel.id, date } },
            create: { tenantId: hotel.tenantId, hotelId: hotel.id, date, ...data },
            update: data,
          })
        }
        result.hotels++
        result.days += forecast.days.length
      }
      result.areas++
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn({ areaCode, error: message }, '天気の予報を取得できませんでした')
      result.failedAreas.push({ areaCode, error: message })
    }
  }
  return result
}
