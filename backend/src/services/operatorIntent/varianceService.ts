import type { DemandLevel, PriceDecisionType, PriceIntentReason } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'

// AI推奨と「実際にやった値」の差異（F-DP-09）。
//
// 2種類の差異を並べて出す:
//   1. 意向差異  : AI推奨ランク／価格 と 運営担当者が適用した値 の差
//   2. 実績差異  : AI予測（稼働率・ADR）と 実績 の差
// さらに、AIの想定どおりに着地した場合のRevPAR（予測稼働率 × 予測ADR）と
// 実績RevPARを比較して「運営判断が結果的にAIの想定を上回ったか」の目安を出す。
//
// 想定RevPARの基準に推奨価格（料金ランクの1名料金）ではなく予測ADRを使うのは、
// 実績RevPARが販売ミックス込みのADRから算出されるため。ランク表の定価と
// ブレンドADRを直接比較すると常に定価側が高く出て、比較として成立しない。
// なお、これは「AI推奨どおりに運用した場合の結果」を厳密に再現した反実仮想では
// なく推定値であり、継続学習では母数（evaluatedCount）と合わせて扱う。

export type DayType = 'weekend' | 'weekday'

/** 実績RevPARと想定RevPARの差がこの割合以内なら互角とみなす */
export const OUTCOME_TOLERANCE = 0.02

export type VarianceOutcome = 'OPERATOR_BETTER' | 'AI_BETTER' | 'EVEN'

export interface VarianceDayInput {
  date: string
  dayType: DayType
  demandLevel: DemandLevel | null
  aiRank: number | null
  aiPrice: number | null
  aiPredictedOccupancy: number | null
  aiPredictedAdr: number | null
  appliedRank: number | null
  appliedPrice: number | null
  decisionType: PriceDecisionType | null
  intentReason: PriceIntentReason | null
  intentNote: string | null
  decidedByName: string | null
  decidedAt: string | null
  decisionCount: number
  actualOccupancy: number | null
  actualAdr: number | null
  actualRevPar: number | null
}

export interface IntentVarianceDay extends VarianceDayInput {
  /** 適用ランク − AI推奨ランク（プラス = 運営担当者が上げた） */
  rankDelta: number | null
  /** 適用価格 − AI推奨価格 */
  priceDelta: number | null
  /** 価格乖離率（AI推奨価格に対する比率） */
  priceDeltaPct: number | null
  /** 実績稼働率 − 予測稼働率（pt） */
  occupancyDelta: number | null
  /** 実績ADR − 予測ADR */
  adrDelta: number | null
  /** AIの想定どおりに着地した場合のRevPAR（予測稼働率 × 予測ADR。予測ADRが無ければAI推奨価格） */
  estimatedAiRevPar: number | null
  /** 実績RevPAR − 想定RevPAR */
  revParDelta: number | null
  outcome: VarianceOutcome | null
}

function round(value: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

/** Hotel.weekendDays 準拠の曜日区分（週末定義のハードコード禁止） */
export function dayTypeOf(date: Date, weekendDays: number[]): DayType {
  return weekendDays.includes(date.getUTCDay()) ? 'weekend' : 'weekday'
}

/** 需要レベル × 曜日区分のセグメントキー（継続学習の集計単位） */
export function segmentKeyOf(demandLevel: DemandLevel | null, dayType: DayType): string {
  return `${demandLevel ?? 'UNKNOWN'}:${dayType}`
}

/**
 * 1日分の差異を算出する（DB非依存の純粋ロジック）
 */
export function computeVarianceDay(input: VarianceDayInput): IntentVarianceDay {
  const rankDelta =
    input.aiRank != null && input.appliedRank != null ? input.appliedRank - input.aiRank : null
  const priceDelta =
    input.aiPrice != null && input.appliedPrice != null ? input.appliedPrice - input.aiPrice : null
  const priceDeltaPct =
    priceDelta != null && input.aiPrice != null && input.aiPrice > 0
      ? round(priceDelta / input.aiPrice, 4)
      : null

  const occupancyDelta =
    input.aiPredictedOccupancy != null && input.actualOccupancy != null
      ? round(input.actualOccupancy - input.aiPredictedOccupancy, 4)
      : null
  const adrDelta =
    input.aiPredictedAdr != null && input.actualAdr != null
      ? round(input.actualAdr - input.aiPredictedAdr, 1)
      : null

  // 予測ADRが無い場合のみ推奨価格で代替する
  const baselineAdr = input.aiPredictedAdr ?? input.aiPrice
  const estimatedAiRevPar =
    input.aiPredictedOccupancy != null && baselineAdr != null
      ? round(input.aiPredictedOccupancy * baselineAdr, 1)
      : null

  const revParDelta =
    estimatedAiRevPar != null && input.actualRevPar != null
      ? round(input.actualRevPar - estimatedAiRevPar, 1)
      : null

  let outcome: VarianceOutcome | null = null
  if (estimatedAiRevPar != null && estimatedAiRevPar > 0 && revParDelta != null) {
    const ratio = revParDelta / estimatedAiRevPar
    outcome = ratio > OUTCOME_TOLERANCE ? 'OPERATOR_BETTER' : ratio < -OUTCOME_TOLERANCE ? 'AI_BETTER' : 'EVEN'
  }

  return { ...input, rankDelta, priceDelta, priceDeltaPct, occupancyDelta, adrDelta, estimatedAiRevPar, revParDelta, outcome }
}

export interface VarianceBreakdown {
  key: string
  label: string
  count: number
  avgRankDelta: number | null
  avgPriceDeltaPct: number | null
  /** 実績がAIの想定RevPARを上回った割合。母数は evaluatedCount */
  outperformRate: number | null
  evaluatedCount: number
}

export interface IntentVarianceSummary {
  totalDays: number
  /** 意向が記録されている日数 */
  decidedDays: number
  acceptedCount: number
  raisedCount: number
  loweredCount: number
  /** AI推奨をそのまま採用した割合（追随率） */
  followRate: number | null
  avgRankDelta: number | null
  avgPriceDeltaPct: number | null
  avgOccupancyDelta: number | null
  avgAdrDelta: number | null
  outperformRate: number | null
  evaluatedCount: number
  byIntentReason: VarianceBreakdown[]
  bySegment: VarianceBreakdown[]
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return round(values.reduce((a, b) => a + b, 0) / values.length, 4)
}

function buildBreakdown(key: string, label: string, days: IntentVarianceDay[]): VarianceBreakdown {
  const evaluated = days.filter((d) => d.outcome != null)
  return {
    key,
    label,
    count: days.length,
    avgRankDelta: average(days.map((d) => d.rankDelta).filter((v): v is number => v != null)),
    avgPriceDeltaPct: average(days.map((d) => d.priceDeltaPct).filter((v): v is number => v != null)),
    outperformRate:
      evaluated.length > 0
        ? round(evaluated.filter((d) => d.outcome === 'OPERATOR_BETTER').length / evaluated.length, 4)
        : null,
    evaluatedCount: evaluated.length,
  }
}

export const INTENT_REASON_LABELS: Record<PriceIntentReason, string> = {
  FOLLOW_AI: 'AI推奨に従う',
  COMPETITOR_MOVE: '競合の動きに追随',
  EVENT_DEMAND: 'イベント・地域需要',
  GROUP_BLOCK: '団体・グループ受入',
  OTA_CAMPAIGN: 'OTAキャンペーン',
  BUDGET_PRESSURE: '予算達成',
  FIELD_INSIGHT: '現場の肌感覚',
  OPERATION_LIMIT: 'オペレーション制約',
  OTHER: 'その他',
}

/**
 * 期間全体の差異サマリ（DB非依存の純粋ロジック）
 */
export function summarizeVariance(days: IntentVarianceDay[]): IntentVarianceSummary {
  const decided = days.filter((d) => d.decisionType != null)
  const evaluated = decided.filter((d) => d.outcome != null)

  const acceptedCount = decided.filter((d) => d.decisionType === 'ACCEPTED').length
  const raisedCount = decided.filter((d) => d.decisionType === 'RAISED').length
  const loweredCount = decided.filter((d) => d.decisionType === 'LOWERED').length

  const reasonKeys = Array.from(
    new Set(decided.map((d) => d.intentReason).filter((r): r is PriceIntentReason => r != null))
  )
  const segmentKeys = Array.from(new Set(decided.map((d) => segmentKeyOf(d.demandLevel, d.dayType))))

  return {
    totalDays: days.length,
    decidedDays: decided.length,
    acceptedCount,
    raisedCount,
    loweredCount,
    followRate: decided.length > 0 ? round(acceptedCount / decided.length, 4) : null,
    avgRankDelta: average(decided.map((d) => d.rankDelta).filter((v): v is number => v != null)),
    avgPriceDeltaPct: average(decided.map((d) => d.priceDeltaPct).filter((v): v is number => v != null)),
    avgOccupancyDelta: average(days.map((d) => d.occupancyDelta).filter((v): v is number => v != null)),
    avgAdrDelta: average(days.map((d) => d.adrDelta).filter((v): v is number => v != null)),
    outperformRate:
      evaluated.length > 0
        ? round(evaluated.filter((d) => d.outcome === 'OPERATOR_BETTER').length / evaluated.length, 4)
        : null,
    evaluatedCount: evaluated.length,
    byIntentReason: reasonKeys.map((reason) =>
      buildBreakdown(
        reason,
        INTENT_REASON_LABELS[reason],
        decided.filter((d) => d.intentReason === reason)
      )
    ),
    bySegment: segmentKeys.map((key) =>
      buildBreakdown(
        key,
        key,
        decided.filter((d) => segmentKeyOf(d.demandLevel, d.dayType) === key)
      )
    ),
  }
}

function monthRange(year: number, month: number): { start: Date; end: Date } {
  return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) }
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * 月次の意向差異レポート（F-DP-09）
 */
export async function getIntentVarianceService(hotelId: string, year: number, month: number) {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')
  const weekendDays = Array.isArray(hotel.weekendDays) ? (hotel.weekendDays as number[]) : [5, 6]

  const { start, end } = monthRange(year, month)

  const [recommendations, dailyData, decisions] = await Promise.all([
    prisma.aiPriceRecommendation.findMany({
      where: { hotelId, date: { gte: start, lt: end }, roomTypeId: null },
    }),
    prisma.dailyData.findMany({ where: { hotelId, date: { gte: start, lt: end } } }),
    prisma.priceDecision.findMany({
      where: { hotelId, date: { gte: start, lt: end }, roomTypeId: null },
      orderBy: { decidedAt: 'asc' },
      include: { decidedBy: { select: { name: true } } },
    }),
  ])

  const recByDate = new Map(recommendations.map((r) => [dateKey(r.date), r]))
  const actualByDate = new Map(dailyData.map((d) => [dateKey(d.date), d]))

  // 同一日に複数の判断があれば最新のものを「実際に適用した値」として扱う
  const decisionsByDate = new Map<string, typeof decisions>()
  for (const d of decisions) {
    const key = dateKey(d.date)
    const list = decisionsByDate.get(key) ?? []
    list.push(d)
    decisionsByDate.set(key, list)
  }

  const days: IntentVarianceDay[] = []
  for (let cursor = new Date(start); cursor < end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = new Date(cursor)
    const key = dateKey(date)
    const rec = recByDate.get(key)
    const actual = actualByDate.get(key)
    const dayDecisions = decisionsByDate.get(key) ?? []
    const latest = dayDecisions.length > 0 ? dayDecisions[dayDecisions.length - 1] : null

    const actualRevPar =
      actual?.revPar ??
      (actual?.occupancy != null && actual?.adr != null ? round(actual.occupancy * actual.adr, 1) : null)

    days.push(
      computeVarianceDay({
        date: key,
        dayType: dayTypeOf(date, weekendDays),
        // 判断時点のスナップショットを優先する（推奨の再計算で過去の差異が変わらないように）
        demandLevel: latest?.aiDemandLevel ?? rec?.demandLevel ?? null,
        aiRank: latest?.aiRecommendedRank ?? rec?.recommendedRank ?? null,
        aiPrice: latest?.aiRecommendedPrice ?? rec?.recommendedPrice ?? null,
        aiPredictedOccupancy: latest?.aiPredictedOccupancy ?? rec?.predictedOccupancy ?? null,
        aiPredictedAdr: latest?.aiPredictedAdr ?? rec?.predictedAdr ?? null,
        appliedRank: latest?.appliedRank ?? null,
        appliedPrice: latest?.appliedPrice ?? null,
        decisionType: latest?.decisionType ?? null,
        intentReason: latest?.intentReason ?? null,
        intentNote: latest?.intentNote ?? null,
        decidedByName: latest?.decidedBy?.name ?? null,
        decidedAt: latest?.decidedAt.toISOString() ?? null,
        decisionCount: dayDecisions.length,
        actualOccupancy: actual?.occupancy ?? null,
        actualAdr: actual?.adr ?? null,
        actualRevPar,
      })
    )
  }

  return { hotelId, year, month, days, summary: summarizeVariance(days) }
}
