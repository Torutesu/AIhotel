import type { DemandLevel, PriceIntentReason } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'
import { dayTypeOf, segmentKeyOf, type DayType, OUTCOME_TOLERANCE } from './varianceService.js'

// 継続学習（F-DP-10）。
//
// 蓄積された PriceDecision（運営担当者の意向）と DailyData（実績）から、
// 「このホテルの運営担当者は、どのセグメントで AI推奨をどちら向きにどれだけ
// 動かすか」をセグメント（需要レベル × 曜日区分）別に学習する。
//
// 設計方針:
//   - 学習結果は自動適用しない。MANAGER が内容を確認して有効化したセグメントだけ
//     需要予測へ反映する（human-in-the-loop）
//   - 代表値は平均ではなく中央値。数回の極端な判断で全体が歪むのを避ける
//   - 件数が少ないセグメント、および実績が伴っていないセグメントは補正0にする
//   - 補正幅は ±MAX_RANK_DELTA にクランプする（誤った意向の増幅防止）
// 詳細な段階設計は docs/継続学習設計.md を参照。

export const CALIBRATION_MODEL_VERSION = 'operator-calibration-v1'

/** このセグメントの判断がこの件数未満なら補正を適用しない */
export const MIN_SAMPLE_COUNT = 5
/** 実績評価の母数がこの件数以上あるとき、結果を補正の可否判定に使う */
export const MIN_EVALUATED_COUNT = 3
/** 運営判断がAI推奨を上回った割合がこれ未満なら補正を適用しない */
export const MIN_OUTPERFORM_RATE = 0.5
/** 予測へ適用するランク補正の上限（±） */
export const MAX_RANK_DELTA = 3
/** 学習に使う過去日数の既定値 */
export const DEFAULT_LOOKBACK_DAYS = 180

export interface DecisionSample {
  segmentKey: string
  demandLevel: DemandLevel | null
  dayType: DayType
  /** 適用ランク − AI推奨ランク */
  rankDelta: number
  intentReason: PriceIntentReason
  /** 実績が判明していない場合は null */
  outperformed: boolean | null
}

export interface ComputedPreferenceProfile {
  segmentKey: string
  demandLevel: DemandLevel | null
  dayType: DayType
  sampleCount: number
  avgRankDelta: number
  medianRankDelta: number
  appliedRankDelta: number
  outperformRate: number | null
  evaluatedCount: number
  dominantIntentReason: PriceIntentReason | null
  /** 補正が0になった理由（UIで運用者に説明するため） */
  suppressedReason: 'INSUFFICIENT_SAMPLES' | 'NOT_OUTPERFORMING' | null
}

function round(value: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

/** 中央値（外れ値に強い代表値） */
export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/** 補正幅を ±max にクランプする */
export function clampRankDelta(value: number, max = MAX_RANK_DELTA): number {
  return Math.min(max, Math.max(-max, value))
}

/** 最頻の意向理由（同数なら先に現れたもの） */
export function dominantIntentReasonOf(reasons: PriceIntentReason[]): PriceIntentReason | null {
  if (reasons.length === 0) return null
  const counts = new Map<PriceIntentReason, number>()
  for (const r of reasons) counts.set(r, (counts.get(r) ?? 0) + 1)
  let best: PriceIntentReason | null = null
  let bestCount = 0
  for (const [reason, count] of counts) {
    if (count > bestCount) {
      best = reason
      bestCount = count
    }
  }
  return best
}

/**
 * セグメント別の意向プロファイルを算出する（DB非依存の純粋ロジック）
 */
export function computePreferenceProfiles(
  samples: DecisionSample[],
  options: { minSampleCount?: number; minEvaluatedCount?: number; minOutperformRate?: number; maxRankDelta?: number } = {}
): ComputedPreferenceProfile[] {
  const {
    minSampleCount = MIN_SAMPLE_COUNT,
    minEvaluatedCount = MIN_EVALUATED_COUNT,
    minOutperformRate = MIN_OUTPERFORM_RATE,
    maxRankDelta = MAX_RANK_DELTA,
  } = options

  const bySegment = new Map<string, DecisionSample[]>()
  for (const sample of samples) {
    const list = bySegment.get(sample.segmentKey) ?? []
    list.push(sample)
    bySegment.set(sample.segmentKey, list)
  }

  const profiles: ComputedPreferenceProfile[] = []
  for (const [segmentKey, group] of bySegment) {
    const deltas = group.map((s) => s.rankDelta)
    const evaluated = group.filter((s) => s.outperformed != null)
    const outperformRate =
      evaluated.length > 0
        ? round(evaluated.filter((s) => s.outperformed === true).length / evaluated.length, 4)
        : null

    let appliedRankDelta = clampRankDelta(Math.round(median(deltas)), maxRankDelta)
    let suppressedReason: ComputedPreferenceProfile['suppressedReason'] = null

    if (group.length < minSampleCount) {
      appliedRankDelta = 0
      suppressedReason = 'INSUFFICIENT_SAMPLES'
    } else if (
      evaluated.length >= minEvaluatedCount &&
      outperformRate != null &&
      outperformRate < minOutperformRate
    ) {
      // 意向どおりに動かしても実績が伴っていないセグメントは学習しない
      appliedRankDelta = 0
      suppressedReason = 'NOT_OUTPERFORMING'
    }

    profiles.push({
      segmentKey,
      demandLevel: group[0].demandLevel,
      dayType: group[0].dayType,
      sampleCount: group.length,
      avgRankDelta: round(deltas.reduce((a, b) => a + b, 0) / deltas.length, 4),
      medianRankDelta: round(median(deltas), 4),
      appliedRankDelta,
      outperformRate,
      evaluatedCount: evaluated.length,
      dominantIntentReason: dominantIntentReasonOf(group.map((s) => s.intentReason)),
      suppressedReason,
    })
  }

  return profiles.sort((a, b) => a.segmentKey.localeCompare(b.segmentKey))
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addUtcDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

/**
 * 判断1件が結果的にAIの想定を上回ったかを判定する。
 * 想定RevPAR（判断時点の予測稼働率 × 予測ADR）と実績RevPARを比較する推定値で、
 * varianceService の outcome と同じ基準を使う。実績が無い日は null（評価対象外）。
 */
export function evaluateOutperformed(params: {
  aiPredictedOccupancy: number | null
  aiPredictedAdr: number | null
  aiRecommendedPrice: number | null
  actualRevPar: number | null
}): boolean | null {
  const { aiPredictedOccupancy, aiPredictedAdr, aiRecommendedPrice, actualRevPar } = params
  const baselineAdr = aiPredictedAdr ?? aiRecommendedPrice
  if (aiPredictedOccupancy == null || baselineAdr == null || actualRevPar == null) return null
  const estimated = aiPredictedOccupancy * baselineAdr
  if (estimated <= 0) return null
  return (actualRevPar - estimated) / estimated > OUTCOME_TOLERANCE
}

export interface RecomputeProfilesResult {
  hotelId: string
  tenantId: string
  lookbackDays: number
  sampleCount: number
  segmentCount: number
  modelVersion: string
  profiles: ComputedPreferenceProfile[]
}

/**
 * 意向プロファイルを再学習し OperatorPreferenceProfile に反映する（F-DP-10）。
 * 既存レコードの isEnabled（人手による承認状態）は引き継ぐ。
 */
export async function recomputePreferenceProfilesService(
  hotelId: string,
  lookbackDays: number = DEFAULT_LOOKBACK_DAYS
): Promise<RecomputeProfilesResult> {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')
  const weekendDays = Array.isArray(hotel.weekendDays) ? (hotel.weekendDays as number[]) : [5, 6]

  const now = new Date()
  const since = addUtcDays(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), -lookbackDays)

  const decisions = await prisma.priceDecision.findMany({
    where: {
      hotelId,
      roomTypeId: null,
      date: { gte: since },
      aiRecommendedRank: { not: null },
      appliedRank: { not: null },
    },
    orderBy: { date: 'asc' },
  })

  const dailyData = await prisma.dailyData.findMany({
    where: { hotelId, date: { gte: since } },
    select: { date: true, occupancy: true, adr: true, revPar: true },
  })
  const actualByDate = new Map(dailyData.map((d) => [dateKey(d.date), d]))

  const samples: DecisionSample[] = decisions.map((d) => {
    const actual = actualByDate.get(dateKey(d.date))
    const actualRevPar =
      actual?.revPar ?? (actual?.occupancy != null && actual?.adr != null ? actual.occupancy * actual.adr : null)
    const dayType = dayTypeOf(d.date, weekendDays)
    return {
      segmentKey: segmentKeyOf(d.aiDemandLevel, dayType),
      demandLevel: d.aiDemandLevel,
      dayType,
      rankDelta: (d.appliedRank as number) - (d.aiRecommendedRank as number),
      intentReason: d.intentReason,
      outperformed: evaluateOutperformed({
        aiPredictedOccupancy: d.aiPredictedOccupancy,
        aiPredictedAdr: d.aiPredictedAdr,
        aiRecommendedPrice: d.aiRecommendedPrice,
        actualRevPar,
      }),
    }
  })

  const profiles = computePreferenceProfiles(samples)

  for (const profile of profiles) {
    await prisma.operatorPreferenceProfile.upsert({
      where: { hotelId_segmentKey: { hotelId, segmentKey: profile.segmentKey } },
      update: {
        demandLevel: profile.demandLevel,
        dayType: profile.dayType,
        sampleCount: profile.sampleCount,
        avgRankDelta: profile.avgRankDelta,
        medianRankDelta: profile.medianRankDelta,
        appliedRankDelta: profile.appliedRankDelta,
        outperformRate: profile.outperformRate,
        evaluatedCount: profile.evaluatedCount,
        dominantIntentReason: profile.dominantIntentReason,
        modelVersion: CALIBRATION_MODEL_VERSION,
        computedAt: new Date(),
      },
      create: {
        tenantId: hotel.tenantId,
        hotelId,
        segmentKey: profile.segmentKey,
        demandLevel: profile.demandLevel,
        dayType: profile.dayType,
        sampleCount: profile.sampleCount,
        avgRankDelta: profile.avgRankDelta,
        medianRankDelta: profile.medianRankDelta,
        appliedRankDelta: profile.appliedRankDelta,
        outperformRate: profile.outperformRate,
        evaluatedCount: profile.evaluatedCount,
        dominantIntentReason: profile.dominantIntentReason,
        modelVersion: CALIBRATION_MODEL_VERSION,
      },
    })
  }

  return {
    hotelId,
    tenantId: hotel.tenantId,
    lookbackDays,
    sampleCount: samples.length,
    segmentCount: profiles.length,
    modelVersion: CALIBRATION_MODEL_VERSION,
    profiles,
  }
}

/**
 * 学習済み意向プロファイル一覧（F-DP-10）
 */
export async function getPreferenceProfilesService(hotelId: string) {
  return prisma.operatorPreferenceProfile.findMany({
    where: { hotelId },
    orderBy: { segmentKey: 'asc' },
  })
}

/**
 * プロファイルの有効／無効切り替え（human-in-the-loop の承認操作。MANAGER以上・監査対象）
 */
export async function setPreferenceProfileEnabledService(
  profileId: string,
  hotelId: string,
  isEnabled: boolean,
  userId: string
) {
  const before = await prisma.operatorPreferenceProfile.findUnique({ where: { id: profileId } })
  // hotelId の一致確認はテナント分離の要（他ホテルのプロファイルを触らせない）
  if (!before || before.hotelId !== hotelId) throw new NotFoundError('意向プロファイル')

  const after = await prisma.operatorPreferenceProfile.update({
    where: { id: profileId },
    data: { isEnabled, enabledByUserId: isEnabled ? userId : null },
  })

  return { before, after }
}
