import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'
import { summarizeAccuracy, type ScoredPrediction, type AccuracySummary } from './evaluation.js'
import { diffDays } from './features.js'
import { loadFeatureSourceData, actualOccupancyOf } from './featureContextService.js'

// ======================================
// 予測精度の記録と測定（4E-1 — docs/ai-agent-design.md §9）
//
// AiPriceRecommendation は「最新の推奨」だけを持ち上書きされるため、
// あとから精度を測れない。ForecastSnapshot に予測時点つきで残し、
// 宿泊日が過ぎたら実績を突き合わせる、という2段構えにする。
// ======================================

export interface SnapshotInput {
  stayDate: Date
  predictedOccupancy: number
  confidence: number
  features?: number[]
}

/**
 * 予測を履歴として記録する。
 * 同じ（宿泊日・予測日・モデル）で複数回走っても1件に収める（冪等）。
 */
export async function recordForecastSnapshotsService(params: {
  hotelId: string
  predictedAt: Date
  modelVersion: string
  snapshots: SnapshotInput[]
}): Promise<{ recorded: number }> {
  const hotel = await prisma.hotel.findUnique({ where: { id: params.hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const predictedAt = dateOnly(params.predictedAt)

  let recorded = 0
  for (const snapshot of params.snapshots) {
    const stayDate = dateOnly(snapshot.stayDate)
    const data = {
      tenantId: hotel.tenantId,
      hotelId: hotel.id,
      stayDate,
      predictedAt,
      leadTimeDays: diffDays(predictedAt, stayDate),
      predictedOccupancy: snapshot.predictedOccupancy,
      confidence: snapshot.confidence,
      modelVersion: params.modelVersion,
      features: (snapshot.features ?? Prisma.DbNull) as Prisma.InputJsonValue,
    }

    await prisma.forecastSnapshot.upsert({
      where: {
        hotelId_stayDate_predictedAt_modelVersion: {
          hotelId: hotel.id,
          stayDate,
          predictedAt,
          modelVersion: params.modelVersion,
        },
      },
      create: data,
      update: {
        predictedOccupancy: data.predictedOccupancy,
        confidence: data.confidence,
        features: data.features,
      },
    })
    recorded += 1
  }

  return { recorded }
}

/**
 * 宿泊日が過ぎた予測に実績を突き合わせる。
 * 日次バッチで呼ぶ想定。実績が未取込の日は放置し、次回以降に埋まる。
 */
export async function scoreForecastSnapshotsService(
  hotelId: string,
  now = new Date()
): Promise<{ scored: number; pending: number }> {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const today = dateOnly(now)
  const unscored = await prisma.forecastSnapshot.findMany({
    where: { hotelId, actualOccupancy: null, stayDate: { lt: today } },
    orderBy: { stayDate: 'asc' },
  })
  if (unscored.length === 0) return { scored: 0, pending: 0 }

  const oldest = unscored[0].stayDate
  const newest = unscored[unscored.length - 1].stayDate
  const data = await loadFeatureSourceData(hotelId, oldest, newest)

  let scored = 0
  let pending = 0
  for (const snapshot of unscored) {
    const actual = actualOccupancyOf(data, snapshot.stayDate)
    if (actual == null) {
      // 実績がまだ取り込まれていない。次回のバッチで拾う
      pending += 1
      continue
    }
    await prisma.forecastSnapshot.update({
      where: { id: snapshot.id },
      data: {
        actualOccupancy: actual,
        absError: Math.abs(snapshot.predictedOccupancy - actual),
        scoredAt: new Date(),
      },
    })
    scored += 1
  }

  return { scored, pending }
}

export interface ForecastAccuracyResult extends AccuracySummary {
  hotelId: string
  from: string
  to: string
  /** まだ実績が確定していない予測の件数（測定対象外） */
  pendingCount: number
}

/**
 * 予測時点別の精度サマリ。MLOps画面と、モデル選択の事後検証に使う。
 */
export async function getForecastAccuracyService(params: {
  hotelId: string
  from?: Date
  to?: Date
  modelVersion?: string
}): Promise<ForecastAccuracyResult> {
  const hotel = await prisma.hotel.findUnique({ where: { id: params.hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const to = dateOnly(params.to ?? new Date())
  const from = dateOnly(params.from ?? new Date(to.getTime() - 180 * 86_400_000))

  const where = {
    hotelId: params.hotelId,
    stayDate: { gte: from, lte: to },
    ...(params.modelVersion ? { modelVersion: params.modelVersion } : {}),
  }

  const [snapshots, pendingCount] = await Promise.all([
    prisma.forecastSnapshot.findMany({
      where: { ...where, actualOccupancy: { not: null } },
      select: {
        leadTimeDays: true,
        predictedOccupancy: true,
        actualOccupancy: true,
        modelVersion: true,
      },
    }),
    prisma.forecastSnapshot.count({ where: { ...where, actualOccupancy: null } }),
  ])

  const scored: ScoredPrediction[] = snapshots.map((s) => ({
    leadTimeDays: s.leadTimeDays,
    predictedOccupancy: s.predictedOccupancy,
    // actualOccupancy: { not: null } で絞っているが型は nullable のままなので明示する
    actualOccupancy: s.actualOccupancy ?? 0,
    modelVersion: s.modelVersion,
  }))

  return {
    hotelId: params.hotelId,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    pendingCount,
    ...summarizeAccuracy(scored),
  }
}

function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
