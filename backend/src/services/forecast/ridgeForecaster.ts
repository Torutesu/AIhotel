// チャレンジャー予測モデル ridge-v1（docs/外部要因設計.md §5.2 L2）。
// rule-based-v2 の要因分解を特徴量にし、学習済み重み（ForecastModelState）で稼働率を再推定する。
// 学習前（状態なし）は rule-based-v2 と同じ結果になる（prior 重み = 1）
import { prisma } from '../../lib/prisma.js'
import type { DailyForecast, DemandForecaster, ForecastInput } from './types.js'
import { ruleBasedForecaster } from './ruleBasedForecaster.js'
import { buildFeatures, emptyRidgeState, predict, solveWeights, type RidgeState } from './ridge.js'
import { mapOccupancyToDemandLevel, mapOccupancyToRank } from './ruleBasedForecaster.js'
import { factorLabel } from './factorDefaults.js'

export const RIDGE_MODEL_VERSION = 'ridge-v1'

export async function loadRidgeState(hotelId: string): Promise<RidgeState> {
  const row = await prisma.forecastModelState.findUnique({ where: { hotelId_modelName: { hotelId, modelName: RIDGE_MODEL_VERSION } } })
  return row ? (row.state as unknown as RidgeState) : emptyRidgeState()
}

export const ridgeForecaster: DemandForecaster = {
  name: RIDGE_MODEL_VERSION,

  async forecast(input: ForecastInput): Promise<DailyForecast[]> {
    const [baseForecasts, state, priceRanks] = await Promise.all([
      ruleBasedForecaster.forecast(input),
      loadRidgeState(input.hotelId),
      prisma.priceRank.findMany({ where: { hotelId: input.hotelId, isActive: true }, select: { rank: true, price1P: true } }),
    ])
    const weights = solveWeights(state)
    const maxRank = priceRanks.length > 0 ? Math.max(...priceRanks.map((r) => r.rank)) : 40
    const priceByRank = new Map(priceRanks.map((r) => [r.rank, r.price1P]))

    return baseForecasts.map((f) => {
      if (!f.demand) return { ...f, modelVersion: RIDGE_MODEL_VERSION }
      const x = buildFeatures(f.demand.demandFactors, f.date.getUTCDay())
      const raw = predict(weights, x)
      const unconstrained = Math.max(0, raw)
      const predicted = Math.min(1, unconstrained)
      const adjustment = unconstrained - f.demand.unconstrainedOccupancy
      const demandFactors = [...f.demand.demandFactors]
      if (Math.abs(adjustment) >= 0.005) {
        demandFactors.push({
          key: 'model:ridge',
          label: factorLabel('model:ridge'),
          pt: adjustment,
          detail: `学習済み重みによる補正（${state.samples}件の実績で学習）`,
        })
      }
      const half = f.demand.confidence.p90 - f.demand.confidence.p50
      const rank = mapOccupancyToRank(predicted, maxRank)
      return {
        ...f,
        predictedOccupancy: predicted,
        demandLevel: mapOccupancyToDemandLevel(predicted),
        recommendedRank: rank,
        recommendedPrice: priceByRank.get(rank) ?? null,
        modelVersion: RIDGE_MODEL_VERSION,
        demand: {
          ...f.demand,
          unconstrainedOccupancy: unconstrained,
          predictedOccupancy: predicted,
          demandLevel: mapOccupancyToDemandLevel(predicted),
          demandFactors,
          confidence: {
            ...f.demand.confidence,
            p50: predicted,
            p10: Math.max(0, predicted - half),
            p90: Math.min(1, predicted + half),
          },
        },
      }
    })
  },
}

/** モデル名 → 実装 */
export function resolveForecaster(name: string | null | undefined): DemandForecaster {
  return name === RIDGE_MODEL_VERSION ? ridgeForecaster : ruleBasedForecaster
}
