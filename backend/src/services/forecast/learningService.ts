// 継続学習の DB 連携（docs/外部要因設計.md §5）。
//   ForecastSnapshot（未学習）× DailyData（実績確定）→ 残差 → FactorCoefficient 更新 → learnedAt を記録
import { prisma } from '../../lib/prisma.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'
import { applyLearning, type CoefficientState, type LearningSample } from './learning.js'
import { toIsoDate } from '../signals/holidaySignal.js'
import type { RecommendationExplanation } from './forecastService.js'

export interface LearnResult {
  hotelId: string
  tenantId: string
  samples: number
  updates: Array<{ key: string; before: number; after: number; sampleSize: number }>
  calibration: Array<{ bucket: string; before: number; after: number; samples: number }>
}

function addUtcDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

/**
 * 実績が確定した宿泊日の未学習スナップショットから係数を更新する。冪等（学習済みは再利用しない）。
 * @param asOfDate 基準日。この日より前の宿泊日のみ対象（当日は実績未確定とみなす）
 */
export async function learnFromActualsService(hotelId: string, asOfDate?: Date, lookbackDays = 120): Promise<LearnResult> {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { id: true, tenantId: true } })
  if (!hotel) throw new NotFoundError('ホテル')

  const asOf = asOfDate ?? new Date()
  const end = addUtcDays(new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate())), -1)
  const start = addUtcDays(end, -lookbackDays)

  const [snapshots, actuals, coefRows] = await Promise.all([
    prisma.forecastSnapshot.findMany({
      where: { hotelId, learnedAt: null, stayDate: { gte: start, lte: end } },
      orderBy: [{ stayDate: 'asc' }, { asOfDate: 'asc' }],
      select: { id: true, stayDate: true, leadDays: true, predictedOccupancy: true, contributions: true },
    }),
    prisma.dailyData.findMany({
      where: { hotelId, date: { gte: start, lte: end }, occupancy: { not: null } },
      select: { date: true, occupancy: true },
    }),
    prisma.factorCoefficient.findMany({ where: { hotelId }, select: { factorKey: true, value: true, sampleSize: true } }),
  ])

  const actualByDate = new Map(actuals.map((a) => [toIsoDate(a.date), a.occupancy!]))
  const samples: LearningSample[] = []
  const learnedIds: string[] = []
  for (const s of snapshots) {
    const actual = actualByDate.get(toIsoDate(s.stayDate))
    if (actual == null) continue // 実績未確定は次回に回す
    const explanation = s.contributions as unknown as RecommendationExplanation | null
    samples.push({
      stayDate: toIsoDate(s.stayDate),
      leadDays: s.leadDays,
      predictedOccupancy: s.predictedOccupancy,
      actualOccupancy: actual,
      activeFactorKeys: explanation?.activeFactorKeys ?? [],
    })
    learnedIds.push(s.id)
  }

  const current = new Map<string, CoefficientState>(coefRows.map((r) => [r.factorKey, { value: r.value, sampleSize: r.sampleSize }]))
  const result = applyLearning(samples, current)

  await prisma.$transaction(async (tx) => {
    for (const [key, state] of result.coefficients) {
      const before = current.get(key)
      if (before && before.value === state.value && before.sampleSize === state.sampleSize) continue
      await tx.factorCoefficient.upsert({
        where: { hotelId_factorKey: { hotelId, factorKey: key } },
        update: { value: state.value, sampleSize: state.sampleSize },
        create: { hotelId, tenantId: hotel.tenantId, factorKey: key, value: state.value, sampleSize: state.sampleSize },
      })
    }
    if (learnedIds.length > 0) {
      await tx.forecastSnapshot.updateMany({ where: { id: { in: learnedIds } }, data: { learnedAt: new Date() } })
    }
  })

  return {
    hotelId,
    tenantId: hotel.tenantId,
    samples: samples.length,
    updates: result.updates,
    calibration: result.calibration,
  }
}

/**
 * 学習済み係数の一覧（初期値との差を UI で見せる用）
 */
export async function getCoefficientsService(hotelId: string) {
  return prisma.factorCoefficient.findMany({
    where: { hotelId },
    orderBy: { factorKey: 'asc' },
    select: { factorKey: true, value: true, sampleSize: true, updatedAt: true },
  })
}
