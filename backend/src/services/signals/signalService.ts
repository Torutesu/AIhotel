// 外部シグナルの取り込みと参照（docs/外部要因設計.md §3, §4）。
//
// - 取り込みは冪等（hotelId+date+signalType+source で upsert）
// - 取得失敗はここで throw し、呼び出し側（日次ジョブ）がアラート化する。予測側は
//   シグナルが無ければ係数0で続行する（古い値をサイレントに使わない: validUntil を見る）
import { prisma } from '../../lib/prisma.js'
import { NotFoundError, BadRequestError } from '../../middlewares/errorHandler.js'
import { logger } from '../../utils/logger.js'
import { fetchJmaForecast, parseJmaForecast } from './weather/jmaAdapter.js'
import { fetchOpenMeteoForecast, isOpenMeteoAvailable, parseOpenMeteoForecast } from './weather/openMeteoAdapter.js'
import type { DailyWeather, WeatherSignalValue } from './weather/types.js'
import { computeHolidaySignal, toIsoDate, type HolidaySignal } from './holidaySignal.js'

export const SIGNAL_TYPE_WEATHER = 'weather'
export const SOURCE_JMA = 'jma'
export const SOURCE_OPEN_METEO = 'open_meteo'

// 気象庁は1日3回更新。36時間で失効させ、取り込みが2回連続で止まったら使わない
const WEATHER_VALID_HOURS = 36

function isoToUtcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`)
}

async function upsertWeatherRows(
  hotelId: string,
  tenantId: string,
  source: string,
  days: DailyWeather[]
): Promise<number> {
  const capturedAt = new Date()
  const validUntil = new Date(capturedAt.getTime() + WEATHER_VALID_HOURS * 3_600_000)
  for (const day of days) {
    const { date, ...value } = day
    await prisma.externalSignal.upsert({
      where: {
        hotelId_date_signalType_source: {
          hotelId,
          date: isoToUtcDate(date),
          signalType: SIGNAL_TYPE_WEATHER,
          source,
        },
      },
      update: { value, capturedAt, validUntil },
      create: {
        hotelId,
        tenantId,
        date: isoToUtcDate(date),
        signalType: SIGNAL_TYPE_WEATHER,
        source,
        value,
        capturedAt,
        validUntil,
      },
    })
  }
  return days.length
}

export interface IngestWeatherResult {
  hotelId: string
  tenantId: string
  jma: { count: number; reportDatetime: string; fallbackAreaCode: string | null } | null
  openMeteo: { count: number } | null
  skipped: string[]
}

/**
 * ホテルの天候予報を取得して ExternalSignal に保存する。
 * 気象庁（7日）を主、Open-Meteo（16日）は有効時のみ補完として保存する。
 */
export async function ingestWeatherSignalsService(hotelId: string): Promise<IngestWeatherResult> {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const result: IngestWeatherResult = { hotelId, tenantId: hotel.tenantId, jma: null, openMeteo: null, skipped: [] }

  if (hotel.jmaOfficeCode && hotel.jmaAreaCode) {
    const raw = await fetchJmaForecast(hotel.jmaOfficeCode)
    const parsed = parseJmaForecast(raw, hotel.jmaAreaCode)
    if (parsed.fallbackAreaCode) {
      logger.warn(
        { hotelId, requested: hotel.jmaAreaCode, used: parsed.fallbackAreaCode },
        '気象庁の一次細分区域コードが予報に含まれないため先頭区域を使用しました。ホテル設定の jmaAreaCode を確認してください'
      )
    }
    const count = await upsertWeatherRows(hotelId, hotel.tenantId, SOURCE_JMA, parsed.days)
    result.jma = { count, reportDatetime: parsed.reportDatetime, fallbackAreaCode: parsed.fallbackAreaCode }
  } else {
    result.skipped.push('jma: ホテル設定に jmaOfficeCode / jmaAreaCode がありません')
  }

  if (!isOpenMeteoAvailable()) {
    result.skipped.push('open_meteo: 無効（WEATHER_OPEN_METEO_ENABLED / OPEN_METEO_API_KEY 未設定）')
  } else if (hotel.latitude == null || hotel.longitude == null) {
    result.skipped.push('open_meteo: ホテル設定に緯度経度がありません')
  } else {
    const raw = await fetchOpenMeteoForecast(hotel.latitude, hotel.longitude)
    const count = await upsertWeatherRows(hotelId, hotel.tenantId, SOURCE_OPEN_METEO, parseOpenMeteoForecast(raw))
    result.openMeteo = { count }
  }

  if (!result.jma && !result.openMeteo) {
    throw new BadRequestError('天候を取得できる設定がありません（気象庁コードまたは Open-Meteo を設定してください）')
  }
  return result
}

export interface WeatherByDate {
  [isoDate: string]: WeatherSignalValue & { source: string; capturedAt: Date }
}

/**
 * 期間内の有効な天候シグナルを日付キーで返す。気象庁を優先し、無い日は Open-Meteo で補完。
 * validUntil を過ぎたものは返さない
 */
export async function getWeatherSignalsService(hotelId: string, startDate: Date, endDate: Date): Promise<WeatherByDate> {
  const now = new Date()
  const rows = await prisma.externalSignal.findMany({
    where: {
      hotelId,
      signalType: SIGNAL_TYPE_WEATHER,
      date: { gte: startDate, lte: endDate },
      OR: [{ validUntil: null }, { validUntil: { gte: now } }],
    },
    orderBy: { capturedAt: 'desc' },
  })
  const out: WeatherByDate = {}
  for (const row of rows) {
    const key = toIsoDate(row.date)
    const existing = out[key]
    if (existing && (existing.source === SOURCE_JMA || row.source !== SOURCE_JMA)) continue
    out[key] = { ...(row.value as unknown as WeatherSignalValue), source: row.source, capturedAt: row.capturedAt }
  }
  return out
}

export interface DailySignalView {
  date: string
  holiday: HolidaySignal
  weather: (WeatherSignalValue & { source: string; capturedAt: Date }) | null
}

/**
 * 画面表示用: 期間内の祝日シグナル（静的）＋天候シグナル（DB）を日別に返す
 */
export async function getSignalsService(hotelId: string, startDate: Date, endDate: Date): Promise<DailySignalView[]> {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { id: true } })
  if (!hotel) throw new NotFoundError('ホテル')
  const weather = await getWeatherSignalsService(hotelId, startDate, endDate)
  const days: DailySignalView[] = []
  for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = toIsoDate(d)
    days.push({ date: key, holiday: computeHolidaySignal(new Date(d)), weather: weather[key] ?? null })
  }
  return days
}
