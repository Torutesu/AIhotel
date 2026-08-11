import { prisma } from '../../lib/prisma.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'
import type { DailyForecast, DemandForecaster, ForecastDemandLevel, ForecastInput } from './types.js'
import { buildFeatureVector, clamp01, diffDays, MAX_LEAD_TIME_DAYS } from './features.js'
import { loadFeatureSourceData, buildFeatureContext } from './featureContextService.js'
import { loadActiveModel, trainerFor } from './trainingService.js'
import type { RateCategory } from '@prisma/client'

// ======================================
// 学習済みモデルによる需要予測（4E-2 — docs/ai-agent-design.md §2, §3）
//
// ForecastModel に保存された Ridge / GBM を読み、日次の稼働率を予測する。
// 学習済みモデルが無い場合は null を返し、呼び出し側がルールベースへ倒す。
//
// このエージェントは**価格を入力に取らない**（設計 §3）。
// 価格→需要→価格の循環を作らないための境界であり、
// 価格の決定は 4E-3 の価格決定エージェントの仕事。
// ======================================

/** 予測稼働率から需要レベル（A〜E）へのマッピング。UI表示名は「アラート」 */
const DEMAND_LEVEL_THRESHOLDS: Array<{ min: number; level: ForecastDemandLevel }> = [
  { min: 0.9, level: 'A' },
  { min: 0.8, level: 'B' },
  { min: 0.65, level: 'C' },
  { min: 0.5, level: 'D' },
  { min: 0, level: 'E' },
]

export function demandLevelOf(occupancy: number): ForecastDemandLevel {
  return DEMAND_LEVEL_THRESHOLDS.find((t) => occupancy >= t.min)?.level ?? 'E'
}

const MS_PER_DAY = 86_400_000

function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/**
 * 確信度スコア（設計 §4）のうち、4E-2 で計算できる2因子。
 *
 * 残る dataSufficiency / stability は価格決定エージェント（4E-3）で
 * 予約推移の異常検知と合わせて算出する。ここで暫定値を作り込むと
 * 後から意味が変わってしまうため、現時点で根拠のある2つだけを掛ける。
 */
export function computeConfidence(params: {
  leadTimeDays: number
  validationMae: number
}): number {
  // 予測地平の減衰: 180日先は当然当たりにくい
  const horizonDecay = 1 - 0.5 * Math.min(1, Math.max(0, params.leadTimeDays) / MAX_LEAD_TIME_DAYS)
  // モデル適合度: 検証MAEが0なら1、20pt以上外すなら0に近づく
  const modelFit = clamp01(1 - params.validationMae / 0.2)
  return Math.round(horizonDecay * modelFit * 1000) / 1000
}

export interface LearnedForecastResult extends DailyForecast {
  /** 予測に使った特徴量。ForecastSnapshot に残して原因調査に使う */
  features: number[]
}

/**
 * 学習済みモデルで予測する。モデルが無ければ null。
 *
 * predictedAt を指定すると、その時点で判明していた情報だけで予測する
 * （バックテスト。4E-1 からの申し送り事項）。
 */
export async function forecastWithLearnedModel(
  input: ForecastInput
): Promise<LearnedForecastResult[] | null> {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const model = await loadActiveModel(input.hotelId)
  if (!model) return null
  const trainer = trainerFor(model.algorithm)
  if (!trainer) return null

  const predictedAt = dateOnly(input.predictedAt ?? new Date())
  const start = dateOnly(input.startDate)
  const end = dateOnly(input.endDate)

  const data = await loadFeatureSourceData(input.hotelId, start, end)

  // 推奨ランクは価格決定エージェント（4E-3）の担当だが、既存画面が
  // recommendedRankCode を参照しているため、暫定として稼働率から素直に引く
  const ranks = await prisma.priceRank.findMany({
    where: { hotelId: input.hotelId, isActive: true, rateCategory: 'OWN' as RateCategory },
    orderBy: { sortOrder: 'asc' },
    select: { rankCode: true, sortOrder: true, price: true },
  })

  const results: LearnedForecastResult[] = []
  for (let d = start; d <= end; d = new Date(d.getTime() + MS_PER_DAY)) {
    const stayDate = new Date(d)
    const context = buildFeatureContext(data, stayDate, predictedAt)
    const features = buildFeatureVector(context)
    const predictedOccupancy = clamp01(trainer.predict(model, features))
    const leadTimeDays = diffDays(predictedAt, stayDate)
    const rank = pickRankForOccupancy(ranks, predictedOccupancy)

    results.push({
      date: stayDate,
      predictedOccupancy,
      demandLevel: demandLevelOf(predictedOccupancy),
      recommendedRank: rank?.sortOrder ?? null,
      recommendedRankCode: rank?.rankCode ?? null,
      recommendedPrice: rank?.price ?? null,
      confidence: computeConfidence({ leadTimeDays, validationMae: model.validationMae }),
      modelVersion: `${model.algorithm}-v1`,
      features,
    })
  }

  return results
}

/**
 * 予測稼働率に応じてランクを引く（暫定）。
 * 需要が高いほど高価格側のランクを選ぶ、という素朴な対応づけ。
 * 本来の価格決定ロジック（在庫・競合・特日を織り込む）は 4E-3 で作る。
 */
function pickRankForOccupancy(
  ranks: Array<{ rankCode: string; sortOrder: number; price: number }>,
  occupancy: number
): { rankCode: string; sortOrder: number; price: number } | null {
  if (ranks.length === 0) return null
  // sortOrder 昇順＝低価格→高価格。稼働率をその並びの位置に写す
  const index = Math.min(ranks.length - 1, Math.floor(clamp01(occupancy) * ranks.length))
  return ranks[index]
}

/**
 * DemandForecaster として使えるようにした形。
 * 学習済みモデルが無い場合は空配列ではなく例外にせず、
 * 呼び出し側（forecastService）がルールベースへフォールバックする。
 */
export const learnedForecaster: DemandForecaster & {
  isAvailable(hotelId: string): Promise<boolean>
} = {
  name: 'learned-v1',
  async forecast(input) {
    const results = await forecastWithLearnedModel(input)
    return results ?? []
  },
  async isAvailable(hotelId) {
    return (await loadActiveModel(hotelId)) !== null
  },
}
