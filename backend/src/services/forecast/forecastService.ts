import { prisma } from '../../lib/prisma.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'
import { Prisma, type DemandLevel } from '@prisma/client'
import type { DailyForecast, DemandForecaster } from './types.js'
import { ruleBasedForecaster } from './ruleBasedForecaster.js'
import { addUtcDays, dateOnly, todayJst } from '../../lib/date.js'

// 需要予測の再計算・DB反映（F-DP-05）。
// F-DP-03（AI予測値へのリセット）のバックエンドとしても機能する:
// 手動で価格ランクを編集した後でも、このサービスを呼べば AiPriceRecommendation が
// 最新のルールベース予測で上書きされ、AI推奨値に戻せる。

const DEFAULT_FORECAST_DAYS = 90

/**
 * ホテル全体（roomTypeId=null）の AiPriceRecommendation を期間まとめて書き換える。
 *
 * 旧実装は1日につき findFirst + create/update の2クエリを直列に発行していたため、
 * 90日で 180 往復していた。deleteMany + createMany の2クエリをトランザクションに
 * まとめる（C-3）。
 *
 * @@unique([hotelId, date, roomTypeId]) は roomTypeId が NULL の場合、
 * SQL の仕様上 NULL 同士は等しいとみなされないため upsert が使えない
 * （Prisma が "Argument roomTypeId must not be null" で拒否する）。
 * 対象期間を一度消してから入れ直すことで、並行実行で生じた重複行も同時に解消する。
 * NULL 同士の重複を DB 側で止める部分ユニーク索引は C-4 のマイグレーションで追加している。
 */
async function replaceHotelWideRecommendations(
  hotelId: string,
  tenantId: string,
  start: Date,
  end: Date,
  forecasts: DailyForecast[],
  lockedDates: Date[] = []
): Promise<void> {
  if (forecasts.length === 0) return

  const computedAt = new Date()

  await prisma.$transaction([
    prisma.aiPriceRecommendation.deleteMany({
      // 固定期間（#17）の日は消さない＝前回の推奨を残す
      where: { hotelId, roomTypeId: null, date: { gte: start, lte: end, notIn: lockedDates } },
    }),
    prisma.aiPriceRecommendation.createMany({
      data: forecasts.map((forecast) => ({
        hotelId,
        tenantId,
        roomTypeId: null,
        date: forecast.date,
        predictedOccupancy: forecast.predictedOccupancy,
        predictedAdr: forecast.predictedAdr,
        recommendedRank: forecast.recommendedRank,
        recommendedPrice: forecast.recommendedPrice,
        demandLevel: forecast.demandLevel as DemandLevel,
        confidence: forecast.confidence,
        modelVersion: forecast.modelVersion,
        rationale: forecast.rationale ? (forecast.rationale as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        computedAt,
      })),
    }),
  ])
}

export interface RecomputeForecastResult {
  count: number
  /** 固定期間（#17）のため更新しなかった日数 */
  lockedDays: number
  modelVersion: string
  tenantId: string
  startDate: string
  endDate: string
}

/**
 * 需要予測を再計算し AiPriceRecommendation に反映する。
 * @param forecaster 差し替え可能な予測実装（デフォルトはルールベース）
 */
export async function recomputeForecastService(
  hotelId: string,
  startDate?: Date,
  endDate?: Date,
  forecaster: DemandForecaster = ruleBasedForecaster
): Promise<RecomputeForecastResult> {
  const hotel = await prisma.hotel.findFirst({ where: { id: hotelId, isActive: true } })
  if (!hotel) throw new NotFoundError('ホテル')

  const start = startDate ? dateOnly(startDate) : todayJst()
  const end = dateOnly(endDate ?? addUtcDays(start, DEFAULT_FORECAST_DAYS))

  const [allForecasts, locks] = await Promise.all([
    forecaster.forecast({ hotelId, startDate: start, endDate: end }),
    prisma.pricingLockPeriod.findMany({
      where: { hotelId, startDate: { lte: end }, endDate: { gte: start } },
      select: { startDate: true, endDate: true },
    }),
  ])

  // 固定期間（#17 のガードレール③）の日は推奨を更新しない
  const isLocked = (date: Date) => locks.some((l) => l.startDate <= date && date <= l.endDate)
  const lockedDates = allForecasts.filter((f) => isLocked(f.date)).map((f) => f.date)
  const forecasts = allForecasts.filter((f) => !isLocked(f.date))

  await replaceHotelWideRecommendations(hotelId, hotel.tenantId, start, end, forecasts, lockedDates)

  return {
    count: forecasts.length,
    lockedDays: lockedDates.length,
    modelVersion: forecaster.name,
    tenantId: hotel.tenantId,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  }
}
