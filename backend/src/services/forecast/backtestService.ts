// バックテスト（docs/外部要因設計.md §5.3）。
// 過去の宿泊日について「基準日 t に利用可能だった情報だけ」で予測を再現し、
// リードタイム区分別の MAPE / バイアス / base のみの MAPE を返す。
// モデル昇格の門番: 全区分で baseline を下回らないことを条件にする。
import { prisma } from '../../lib/prisma.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'
import { ruleBasedForecaster } from './ruleBasedForecaster.js'
import type { DemandForecaster } from './types.js'
import { summarizeAccuracy, type AccuracySummary, type LearningSample } from './learning.js'
import { toIsoDate } from '../signals/holidaySignal.js'

export interface BacktestResult {
  hotelId: string
  modelVersion: string
  startDate: string
  endDate: string
  leadDays: number[]
  samples: number
  summary: AccuracySummary[]
  /** 全区分で baseline（要因なし）以上の精度か（同等 = MAPE 差 0.005 以内 は「以上」とみなす） */
  beatsBaseline: boolean
}

/** 精度比較の同等許容幅（MAPE の絶対差）。seed のような雑音だけのデータで僅差の負けを不合格にしない */
export const BACKTEST_TOLERANCE = 0.005

const DEFAULT_LEADS = [1, 7, 30]
const MAX_BACKTEST_DAYS = 120

function addUtcDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

export async function runBacktestService(
  hotelId: string,
  startDate: Date,
  endDate: Date,
  leadDays: number[] = DEFAULT_LEADS,
  forecaster: DemandForecaster = ruleBasedForecaster
): Promise<BacktestResult> {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { id: true } })
  if (!hotel) throw new NotFoundError('ホテル')

  const days = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1
  const cappedEnd = days > MAX_BACKTEST_DAYS ? addUtcDays(startDate, MAX_BACKTEST_DAYS - 1) : endDate

  const actuals = await prisma.dailyData.findMany({
    where: { hotelId, date: { gte: startDate, lte: cappedEnd }, occupancy: { not: null } },
    select: { date: true, occupancy: true },
    orderBy: { date: 'asc' },
  })

  const samples: Array<LearningSample & { baseOccupancy?: number }> = []
  for (const lead of leadDays) {
    for (const a of actuals) {
      const asOf = addUtcDays(a.date, -lead)
      const [f] = await forecaster.forecast({ hotelId, startDate: a.date, endDate: a.date, asOfDate: asOf })
      if (!f) continue
      samples.push({
        stayDate: toIsoDate(a.date),
        leadDays: lead,
        predictedOccupancy: f.predictedOccupancy,
        actualOccupancy: a.occupancy!,
        activeFactorKeys: f.demand?.activeFactorKeys ?? [],
        baseOccupancy: f.demand?.baseOccupancy,
      })
    }
  }

  const summary = summarizeAccuracy(samples)
  return {
    hotelId,
    modelVersion: forecaster.name,
    startDate: toIsoDate(startDate),
    endDate: toIsoDate(cappedEnd),
    leadDays,
    samples: samples.length,
    summary,
    beatsBaseline: summary.every((s) => s.baselineMape == null || s.mape <= s.baselineMape + BACKTEST_TOLERANCE),
  }
}
