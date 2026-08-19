import { prisma } from '../../lib/prisma.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'
import { CALIBRATION_MODEL_VERSION } from '../operatorIntent/learningService.js'
import { dayTypeOf, segmentKeyOf } from '../operatorIntent/varianceService.js'
import type { DailyForecast, DemandForecaster, ForecastInput } from './types.js'
import { ruleBasedForecaster } from './ruleBasedForecaster.js'

// 継続学習の反映層（F-DP-10）。
//
// ベースの需要予測（ルールベース）に対し、運営担当者の意向プロファイルのうち
// MANAGER が有効化したセグメントの補正だけを後から重ねる。ベース予測の実装には
// 手を入れないので、将来ベースをMLモデルへ差し替えてもこの層はそのまま使える。

const DEFAULT_MAX_RANK = 40

/**
 * 1日分の予測に意向補正を適用する（DB非依存の純粋ロジック）。
 * 補正後のランクは 1〜maxRank にクランプし、推奨価格を料金ランクマスタから引き直す。
 */
export function applyOperatorCalibration(
  forecast: DailyForecast,
  rankDelta: number,
  maxRank: number,
  priceByRank: Map<number, number>
): DailyForecast {
  if (rankDelta === 0 || forecast.recommendedRank == null) {
    return { ...forecast, operatorRankDelta: 0 }
  }

  const adjustedRank = Math.min(maxRank, Math.max(1, forecast.recommendedRank + rankDelta))
  const appliedDelta = adjustedRank - forecast.recommendedRank

  return {
    ...forecast,
    recommendedRank: adjustedRank,
    recommendedPrice: priceByRank.get(adjustedRank) ?? forecast.recommendedPrice,
    operatorRankDelta: appliedDelta,
    modelVersion: `${forecast.modelVersion}+${CALIBRATION_MODEL_VERSION}`,
  }
}

/**
 * ベース予測に意向補正を重ねる Forecaster を作る。
 */
export function createCalibratedForecaster(base: DemandForecaster): DemandForecaster {
  return {
    name: `${base.name}+${CALIBRATION_MODEL_VERSION}`,

    async forecast(input: ForecastInput): Promise<DailyForecast[]> {
      const forecasts = await base.forecast(input)

      const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId } })
      if (!hotel) throw new NotFoundError('ホテル')
      const weekendDays = Array.isArray(hotel.weekendDays) ? (hotel.weekendDays as number[]) : [5, 6]

      const [profiles, priceRanks] = await Promise.all([
        prisma.operatorPreferenceProfile.findMany({
          where: { hotelId: input.hotelId, isEnabled: true },
        }),
        prisma.priceRank.findMany({ where: { hotelId: input.hotelId, isActive: true } }),
      ])

      if (profiles.length === 0) return forecasts

      const deltaBySegment = new Map(profiles.map((p) => [p.segmentKey, p.appliedRankDelta]))
      const maxRank = priceRanks.length > 0 ? Math.max(...priceRanks.map((r) => r.rank)) : DEFAULT_MAX_RANK
      const priceByRank = new Map(priceRanks.map((r) => [r.rank, r.price1P]))

      return forecasts.map((forecast) => {
        const segmentKey = segmentKeyOf(forecast.demandLevel, dayTypeOf(forecast.date, weekendDays))
        return applyOperatorCalibration(forecast, deltaBySegment.get(segmentKey) ?? 0, maxRank, priceByRank)
      })
    },
  }
}

/** 既定の予測実装: ルールベース + 有効化済み意向プロファイル補正 */
export const calibratedForecaster: DemandForecaster = createCalibratedForecaster(ruleBasedForecaster)
