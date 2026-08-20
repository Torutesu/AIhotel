import type { DemandLevel, ForecastVarianceReason } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'
import {
  aggregateMetrics,
  analyzeByReason,
  compareAccuracy,
  computeForecastVariance,
  deriveForecastMetrics,
  evaluateThreshold,
  type AccuracyComparison,
  type ForecastMetrics,
  type ForecastVariance,
  type MetricTotals,
  type ReasonBreakdown,
  type ReasonSample,
  type VarianceMetricKey,
} from './metrics.js'
import { aiMetricsOf, getVarianceThresholds } from './operatorForecastService.js'

// AI予測とレベニュー担当予測の差異レポート（F-DP-11 / F-DP-12）。
//
// 比較の基準は「初期予測どうし」。担当者が最初に立てた見立て（version=1）と、
// その時点のAI予測スナップショットを突き合わせる。以降の改訂は別枠で見せる。

export type DayType = 'weekend' | 'weekday'

export interface ForecastVarianceDay {
  date: string
  dayType: DayType
  demandLevel: DemandLevel | null
  /** 初期予測時点のAI予測 */
  ai: ForecastMetrics
  /** 担当者の初期予測（version=1） */
  operator: ForecastMetrics
  /** 改訂後の最新予測。改訂が無ければ null */
  operatorLatest: ForecastMetrics | null
  revisionCount: number
  actual: ForecastMetrics
  variance: ForecastVariance
  exceededThreshold: boolean
  breachedMetrics: VarianceMetricKey[]
  varianceReason: ForecastVarianceReason | null
  varianceNote: string | null
  forecastedByName: string | null
  forecastedAt: string | null
  accuracy: AccuracyComparison
}

export interface ForecastVarianceSummary {
  totalDays: number
  /** 担当者予測が入っている日数 */
  forecastedDays: number
  /** 乖離が閾値を超えた日数 */
  exceededDays: number
  /** 閾値超えのうち意図・背景が記入されている日数 */
  explainedDays: number
  avgOccupancyDelta: number | null
  avgAdrDeltaPct: number | null
  avgRevenueDeltaPct: number | null
  /** 実績が判明した日のうち、担当者予測の方が近かった割合 */
  operatorCloserRate: number | null
  aiCloserRate: number | null
  evaluatedDays: number
  byReason: ReasonBreakdown[]
}

export interface MonthlyRollup {
  ai: MetricTotals
  operator: MetricTotals
  actual: MetricTotals
}

function round(value: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(value * f) / f
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function monthRange(year: number, month: number): { start: Date; end: Date } {
  return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) }
}

export function dayTypeOf(date: Date, weekendDays: number[]): DayType {
  return weekendDays.includes(date.getUTCDay()) ? 'weekend' : 'weekday'
}

function average(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v != null)
  if (nums.length === 0) return null
  return round(nums.reduce((a, b) => a + b, 0) / nums.length, 4)
}

/**
 * 日別の差異行からサマリを組み立てる（DB非依存の純粋ロジック）
 */
export function summarizeForecastVariance(days: ForecastVarianceDay[]): ForecastVarianceSummary {
  const forecasted = days.filter((d) => d.operator.occupancy != null || d.operator.revenue != null)
  const exceeded = forecasted.filter((d) => d.exceededThreshold)
  const evaluated = forecasted.filter((d) => d.accuracy.overall != null)

  const samples: ReasonSample[] = forecasted
    .filter((d): d is ForecastVarianceDay & { varianceReason: ForecastVarianceReason } => d.varianceReason != null)
    .map((d) => ({ reason: d.varianceReason, variance: d.variance, accuracy: d.accuracy }))

  return {
    totalDays: days.length,
    forecastedDays: forecasted.length,
    exceededDays: exceeded.length,
    explainedDays: exceeded.filter((d) => d.varianceReason != null).length,
    avgOccupancyDelta: average(forecasted.map((d) => d.variance.occupancyDelta)),
    avgAdrDeltaPct: average(forecasted.map((d) => d.variance.adrDeltaPct)),
    avgRevenueDeltaPct: average(forecasted.map((d) => d.variance.revenueDeltaPct)),
    operatorCloserRate:
      evaluated.length > 0
        ? round(evaluated.filter((d) => d.accuracy.overall === 'OPERATOR').length / evaluated.length, 4)
        : null,
    aiCloserRate:
      evaluated.length > 0
        ? round(evaluated.filter((d) => d.accuracy.overall === 'AI').length / evaluated.length, 4)
        : null,
    evaluatedDays: evaluated.length,
    byReason: analyzeByReason(samples),
  }
}

/**
 * 月次のAI予測 / 担当者予測 / 実績の差異レポート（F-DP-11 / F-DP-12）
 */
export async function getForecastVarianceService(hotelId: string, year: number, month: number) {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')
  const weekendDays = Array.isArray(hotel.weekendDays) ? (hotel.weekendDays as number[]) : [5, 6]

  const { start, end } = monthRange(year, month)
  const thresholds = await getVarianceThresholds(hotelId)

  const [recommendations, dailyData, forecasts] = await Promise.all([
    prisma.aiPriceRecommendation.findMany({
      where: { hotelId, roomTypeId: null, date: { gte: start, lt: end } },
    }),
    prisma.dailyData.findMany({ where: { hotelId, date: { gte: start, lt: end } } }),
    prisma.operatorForecast.findMany({
      where: { hotelId, date: { gte: start, lt: end } },
      orderBy: [{ date: 'asc' }, { version: 'asc' }],
      include: { createdBy: { select: { name: true } } },
    }),
  ])

  const recByDate = new Map(recommendations.map((r) => [dateKey(r.date), r]))
  const actualByDate = new Map(dailyData.map((d) => [dateKey(d.date), d]))
  const forecastsByDate = new Map<string, typeof forecasts>()
  for (const f of forecasts) {
    const key = dateKey(f.date)
    const list = forecastsByDate.get(key) ?? []
    list.push(f)
    forecastsByDate.set(key, list)
  }

  const days: ForecastVarianceDay[] = []
  for (let cursor = new Date(start); cursor < end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = new Date(cursor)
    const key = dateKey(date)
    const rec = recByDate.get(key)
    const actualRow = actualByDate.get(key)
    const dayForecasts = forecastsByDate.get(key) ?? []
    const initial = dayForecasts[0] ?? null
    const latest = dayForecasts.length > 1 ? dayForecasts[dayForecasts.length - 1] : null

    // 初期予測がある日はその時点のAIスナップショットを使う。
    // まだ担当者予測が無い日は、比較の目安として現在のAI予測を出す。
    const ai: ForecastMetrics = initial
      ? {
          occupancy: initial.aiOccupancy,
          adr: initial.aiAdr,
          soldRooms: initial.aiSoldRooms,
          revenue: initial.aiRevenue,
        }
      : aiMetricsOf(rec, hotel.totalRooms)

    const operator: ForecastMetrics = {
      occupancy: initial?.forecastOccupancy ?? null,
      adr: initial?.forecastAdr ?? null,
      soldRooms: initial?.forecastSoldRooms ?? null,
      revenue: initial?.forecastRevenue ?? null,
    }

    const operatorLatest: ForecastMetrics | null = latest
      ? {
          occupancy: latest.forecastOccupancy,
          adr: latest.forecastAdr,
          soldRooms: latest.forecastSoldRooms,
          revenue: latest.forecastRevenue,
        }
      : null

    const actual: ForecastMetrics = deriveForecastMetrics(
      {
        occupancy: actualRow?.occupancy ?? null,
        adr: actualRow?.adr ?? null,
        soldRooms: actualRow?.soldRooms ?? null,
        revenue: actualRow?.totalRevenue ?? null,
      },
      hotel.totalRooms
    )

    const variance = computeForecastVariance(ai, operator)
    const { exceeded, breached } = evaluateThreshold(variance, thresholds)

    days.push({
      date: key,
      dayType: dayTypeOf(date, weekendDays),
      demandLevel: initial?.aiDemandLevel ?? rec?.demandLevel ?? null,
      ai,
      operator,
      operatorLatest,
      revisionCount: Math.max(0, dayForecasts.length - 1),
      actual,
      variance,
      // 保存時の判定を正としつつ、閾値が後から変わった場合は再判定の結果も反映する
      exceededThreshold: initial ? initial.exceededThreshold || exceeded : false,
      breachedMetrics: breached,
      varianceReason: initial?.varianceReason ?? null,
      varianceNote: initial?.varianceNote ?? null,
      forecastedByName: initial?.createdBy?.name ?? null,
      forecastedAt: initial?.createdAt.toISOString() ?? null,
      accuracy: compareAccuracy(ai, operator, actual),
    })
  }

  const forecastedDays = days.filter((d) => d.operator.occupancy != null || d.operator.revenue != null)
  const monthly: MonthlyRollup = {
    ai: aggregateMetrics(
      forecastedDays.map((d) => d.ai),
      hotel.totalRooms
    ),
    operator: aggregateMetrics(
      forecastedDays.map((d) => d.operator),
      hotel.totalRooms
    ),
    actual: aggregateMetrics(
      forecastedDays.map((d) => d.actual),
      hotel.totalRooms
    ),
  }

  return {
    hotelId,
    year,
    month,
    totalRooms: hotel.totalRooms,
    thresholds,
    days,
    monthly,
    summary: summarizeForecastVariance(days),
  }
}
