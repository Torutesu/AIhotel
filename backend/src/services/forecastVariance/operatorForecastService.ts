import type { ForecastVarianceReason, Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { ApiError, NotFoundError } from '../../middlewares/errorHandler.js'
import {
  DEFAULT_THRESHOLDS,
  computeForecastVariance,
  deriveForecastMetrics,
  evaluateThreshold,
  type ForecastMetrics,
  type VarianceThresholds,
} from './metrics.js'

// レベニュー担当の日別予測の登録・取得（F-DP-11）。
//
// 同じ宿泊日の予測は上書きせず version を上げて追記する。version=1 が初期予測で、
// AIの初期予測との差異分析はこの版を基準に行う。

export interface OperatorForecastInput {
  date: Date
  occupancy?: number
  adr?: number
  soldRooms?: number
  revenue?: number
  varianceReason?: ForecastVarianceReason
  varianceNote?: string
}

function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** ホテル別の閾値設定。未設定なら既定値を返す（設定レコードは作らない） */
export async function getVarianceThresholds(hotelId: string): Promise<VarianceThresholds> {
  const setting = await prisma.forecastVarianceSetting.findUnique({ where: { hotelId } })
  if (!setting) return { ...DEFAULT_THRESHOLDS }
  return {
    occupancyPtThreshold: setting.occupancyPtThreshold,
    adrPctThreshold: setting.adrPctThreshold,
    revenuePctThreshold: setting.revenuePctThreshold,
  }
}

/**
 * AI推奨レコードを4指標に正規化する。
 * AI側は稼働率とADRしか持たないため、室数・売上は総室数から導出する。
 */
export function aiMetricsOf(
  rec: { predictedOccupancy: number | null; predictedAdr: number | null } | null | undefined,
  totalRooms: number
): ForecastMetrics {
  if (!rec) return { occupancy: null, adr: null, soldRooms: null, revenue: null }
  return deriveForecastMetrics({ occupancy: rec.predictedOccupancy, adr: rec.predictedAdr }, totalRooms)
}

export interface SaveOperatorForecastsResult {
  hotelId: string
  tenantId: string
  saved: number
  exceededCount: number
  dates: string[]
}

/**
 * レベニュー担当の日別予測をまとめて登録する（F-DP-11）。
 *
 * 乖離が閾値を超えた日は意図・背景（varianceReason）を必須にする。
 * 1件でも欠けていれば何も保存せず 400 を返す（部分保存は差異分析の穴になるため）。
 */
export async function saveOperatorForecastsService(
  hotelId: string,
  entries: OperatorForecastInput[],
  createdByUserId: string
): Promise<SaveOperatorForecastsResult> {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const dates = entries.map((e) => dateOnly(e.date))
  const thresholds = await getVarianceThresholds(hotelId)

  const [recommendations, existing] = await Promise.all([
    prisma.aiPriceRecommendation.findMany({
      where: { hotelId, roomTypeId: null, date: { in: dates } },
    }),
    prisma.operatorForecast.findMany({
      where: { hotelId, date: { in: dates } },
      select: { date: true, version: true },
    }),
  ])

  const recByDate = new Map(recommendations.map((r) => [dateKey(r.date), r]))
  const maxVersionByDate = new Map<string, number>()
  for (const row of existing) {
    const key = dateKey(row.date)
    maxVersionByDate.set(key, Math.max(maxVersionByDate.get(key) ?? 0, row.version))
  }

  const rows: Prisma.OperatorForecastCreateManyInput[] = []
  const errors: Array<{ field: string; message: string }> = []
  let exceededCount = 0

  entries.forEach((entry, index) => {
    const date = dateOnly(entry.date)
    const key = dateKey(date)
    const rec = recByDate.get(key)

    const human = deriveForecastMetrics(
      {
        occupancy: entry.occupancy ?? null,
        adr: entry.adr ?? null,
        soldRooms: entry.soldRooms ?? null,
        revenue: entry.revenue ?? null,
      },
      hotel.totalRooms
    )
    const ai = aiMetricsOf(rec, hotel.totalRooms)
    const variance = computeForecastVariance(ai, human)
    const { exceeded } = evaluateThreshold(variance, thresholds)

    if (exceeded) {
      exceededCount += 1
      if (!entry.varianceReason) {
        errors.push({
          field: `entries.${index}.varianceReason`,
          message: `${key}: AI予測との乖離が基準を超えています。意図・背景の選択が必要です`,
        })
      }
    }

    rows.push({
      tenantId: hotel.tenantId,
      hotelId,
      date,
      version: (maxVersionByDate.get(key) ?? 0) + 1,
      forecastOccupancy: human.occupancy,
      forecastAdr: human.adr,
      forecastSoldRooms: human.soldRooms,
      forecastRevenue: human.revenue,
      aiOccupancy: ai.occupancy,
      aiAdr: ai.adr,
      aiSoldRooms: ai.soldRooms,
      aiRevenue: ai.revenue,
      aiDemandLevel: rec?.demandLevel ?? null,
      aiConfidence: rec?.confidence ?? null,
      aiModelVersion: rec?.modelVersion ?? null,
      exceededThreshold: exceeded,
      // 閾値以内でも任意で理由を書ける。必須だったかどうかは exceededThreshold 側で区別する
      varianceReason: entry.varianceReason ?? null,
      varianceNote: entry.varianceNote ?? null,
      createdByUserId,
    })
  })

  if (errors.length > 0) {
    throw new ApiError(400, '意図・背景が未入力の日があります', errors)
  }

  await prisma.operatorForecast.createMany({ data: rows })

  return {
    hotelId,
    tenantId: hotel.tenantId,
    saved: rows.length,
    exceededCount,
    dates: rows.map((r) => dateKey(r.date as Date)),
  }
}

/**
 * 期間内の担当者予測を全バージョン返す（F-DP-11）
 */
export async function listOperatorForecastsService(hotelId: string, startDate: Date, endDate: Date) {
  return prisma.operatorForecast.findMany({
    where: { hotelId, date: { gte: dateOnly(startDate), lte: dateOnly(endDate) } },
    orderBy: [{ date: 'asc' }, { version: 'asc' }],
    include: { createdBy: { select: { id: true, name: true, role: true } } },
  })
}

/**
 * 閾値設定の取得。未設定なら既定値をそのまま返す
 */
export async function getVarianceSettingService(hotelId: string) {
  const setting = await prisma.forecastVarianceSetting.findUnique({ where: { hotelId } })
  if (setting) return setting
  return { hotelId, ...DEFAULT_THRESHOLDS, isDefault: true }
}

/**
 * 閾値設定の更新（MANAGER以上・監査対象 — F-DP-12）
 */
export async function updateVarianceSettingService(
  hotelId: string,
  thresholds: VarianceThresholds,
  updatedByUserId: string
) {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const before = await prisma.forecastVarianceSetting.findUnique({ where: { hotelId } })
  const after = await prisma.forecastVarianceSetting.upsert({
    where: { hotelId },
    update: { ...thresholds, updatedByUserId },
    create: { hotelId, tenantId: hotel.tenantId, ...thresholds, updatedByUserId },
  })

  return { before, after }
}
