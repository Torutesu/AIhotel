import { prisma } from '../../lib/prisma.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'
import type { DemandLevel } from '@prisma/client'
import type { DailyForecast, DemandForecaster } from './types.js'
import { ruleBasedForecaster } from './ruleBasedForecaster.js'

// 需要予測の再計算・DB反映（F-DP-05）。
// F-DP-03（AI予測値へのリセット）のバックエンドとしても機能する:
// 手動で価格ランクを編集した後でも、このサービスを呼べば AiPriceRecommendation が
// 最新のルールベース予測で上書きされ、AI推奨値に戻せる。

// レベニュー担当者は約330日先を見る運用のため、1年先まで既定で予測する
// （F-DP-05。Excel取込後の自動再計算も同じ期間で行われる）
const DEFAULT_FORECAST_DAYS = 365

function addUtcDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/**
 * ホテル全体（roomTypeId=null）の AiPriceRecommendation を1件アップサートする。
 *
 * @@unique([hotelId, date, roomTypeId]) は roomTypeId が NULL の場合、
 * SQL の仕様上 NULL 同士は等しいとみなされないため、Prisma の
 * upsert(where: { hotelId_date_roomTypeId: { ..., roomTypeId: null } }) は
 * 使用できない（実行時に "Argument roomTypeId must not be null" で拒否される）。
 * そのため findFirst → create/update による手動アップサートで対応する。
 */
async function upsertHotelWideRecommendation(hotelId: string, tenantId: string, forecast: DailyForecast): Promise<void> {
  const existing = await prisma.aiPriceRecommendation.findFirst({
    where: { hotelId, date: forecast.date, roomTypeId: null },
    select: { id: true },
  })

  const data = {
    predictedOccupancy: forecast.predictedOccupancy,
    recommendedRank: forecast.recommendedRank,
    recommendedPrice: forecast.recommendedPrice,
    demandLevel: forecast.demandLevel as DemandLevel,
    confidence: forecast.confidence,
    modelVersion: forecast.modelVersion,
    computedAt: new Date(),
  }

  if (existing) {
    await prisma.aiPriceRecommendation.update({ where: { id: existing.id }, data })
  } else {
    await prisma.aiPriceRecommendation.create({
      data: { hotelId, tenantId, date: forecast.date, ...data },
    })
  }
}

export interface RecomputeForecastResult {
  count: number
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
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const start = dateOnly(startDate ?? new Date())
  const end = dateOnly(endDate ?? addUtcDays(start, DEFAULT_FORECAST_DAYS))

  const forecasts = await forecaster.forecast({ hotelId, startDate: start, endDate: end })

  for (const forecast of forecasts) {
    await upsertHotelWideRecommendation(hotelId, hotel.tenantId, forecast)
  }

  return {
    count: forecasts.length,
    modelVersion: forecaster.name,
    tenantId: hotel.tenantId,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  }
}
