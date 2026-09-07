// 需要予測 v2 のコア（docs/外部要因設計.md §2.1）。DB 非依存の純粋ロジック。
//
//   D = clamp( Base × PaceBlend + Σ_k β_k × S_k , 0, 1 )
//
// - Base: 直近28日同曜日移動平均 0.7 + 前年同日 0.3（rule-based-v1 と同じ）
// - Pace: OTB からの投影稼働率とリードタイム別 α で Base と加重（OTB が無ければ α=0）
// - S_k: イベント / 祝日・連休 / 特別期間 / 学校休暇 / 天候 / ホテル週末 の要因キー
// - β_k: FactorCoefficient（学習値）→ factorDefaults（初期値）
// すべての要因は demandFactors として pt 単位で返し、UI と学習の両方に使う。
import {
  computeMovingAverageBySameWeekday,
  computeYearOverYearOccupancy,
  mapOccupancyToDemandLevel,
  type OccupancyRecord,
  type EventImpactRecord,
} from './ruleBasedForecaster.js'
import { factorLabel, getCoefficient, leadBucket, type CoefficientMap } from './factorDefaults.js'
import { holidayFactorKeys, type HolidaySignal } from '../signals/holidaySignal.js'
import type { WeatherSignalValue } from '../signals/weather/types.js'
import type { ForecastDemandLevel } from './types.js'

export interface DemandFactor {
  key: string
  label: string
  /** 稼働率への寄与（pt。0.05 = +5pt） */
  pt: number
  detail?: string
}

export interface PaceObservation {
  roomsOnBooks: number
  daysBefore: number
  /** OTB からの投影稼働率（bookingCurve.ts の projectOccupancyFromPace） */
  projectedOccupancy: number
  usedDefaultCurve: boolean
}

export interface DemandModelInput {
  targetDate: Date
  leadDays: number
  history: OccupancyRecord[]
  events: EventImpactRecord[]
  weekendDays: number[]
  holiday: HolidaySignal
  weather: WeatherSignalValue | null
  pace: PaceObservation | null
  coefficients: CoefficientMap
  /** 競合の売止め比率（0〜1）。データが無ければ null。エリア逼迫の代理指標（docs/外部要因設計.md §3 #6） */
  competitorSoldOutShare?: number | null
  fallbackOccupancy?: number
}

export interface DemandModelResult {
  date: Date
  leadDays: number
  baseOccupancy: number
  movingAverage: number | null
  yearOverYear: number | null
  /** clamp 前（1 を超えうる）。価格反応モデルの潜在需要に使う */
  unconstrainedOccupancy: number
  predictedOccupancy: number
  demandLevel: ForecastDemandLevel
  demandFactors: DemandFactor[]
  /** 学習用: この日に効いた係数キー（base/pace を除く） */
  activeFactorKeys: string[]
  confidence: { p10: number; p50: number; p90: number; scalar: number; leadBucket: string; mape: number }
}

const FALLBACK_OCCUPANCY = 0.6

export function computeDemand(input: DemandModelInput): DemandModelResult {
  const { targetDate, leadDays, history, events, weekendDays, holiday, weather, pace, coefficients } = input
  const factors: DemandFactor[] = []
  const activeKeys: string[] = []

  // ---- Base
  const movingAverage = computeMovingAverageBySameWeekday(history, targetDate)
  const yearOverYear = computeYearOverYearOccupancy(history, targetDate)
  let base: number
  let baseDetail: string
  if (movingAverage != null && yearOverYear != null) {
    base = movingAverage * 0.7 + yearOverYear * 0.3
    baseDetail = `同曜日28日平均 ${(movingAverage * 100).toFixed(0)}% × 0.7 ＋ 前年同日 ${(yearOverYear * 100).toFixed(0)}% × 0.3`
  } else if (movingAverage != null) {
    base = movingAverage
    baseDetail = `同曜日28日平均 ${(movingAverage * 100).toFixed(0)}%（前年データなし）`
  } else if (yearOverYear != null) {
    base = yearOverYear
    baseDetail = `前年同日 ${(yearOverYear * 100).toFixed(0)}%（直近データなし）`
  } else {
    base = input.fallbackOccupancy ?? FALLBACK_OCCUPANCY
    baseDetail = '実績データなし（既定値）'
  }
  factors.push({ key: 'base', label: factorLabel('base'), pt: base, detail: baseDetail })

  let total = base

  // ---- Pace（OTB があるときだけ）
  if (pace && pace.roomsOnBooks > 0) {
    const alpha = getCoefficient(coefficients, `pace:alpha_${leadBucket(leadDays)}`)
    const blended = (1 - alpha) * base + alpha * pace.projectedOccupancy
    const delta = blended - base
    const ratio = base > 0 ? pace.projectedOccupancy / base - 1 : 0
    factors.push({
      key: 'pace',
      label: factorLabel('pace'),
      pt: delta,
      detail: `${pace.daysBefore}日前時点 ${pace.roomsOnBooks}室 → 投影 ${(pace.projectedOccupancy * 100).toFixed(0)}%（基準比 ${ratio >= 0 ? '+' : ''}${(ratio * 100).toFixed(0)}%、信頼度 α=${alpha.toFixed(2)}${pace.usedDefaultCurve ? '、既定曲線' : ''}）`,
    })
    total += delta
  }

  // ---- ホテル週末（Hotel.weekendDays。同曜日平均が既に吸収しているため係数は小さい）
  if (weekendDays.includes(targetDate.getUTCDay())) {
    const key = 'weekend:hotel'
    const pt = getCoefficient(coefficients, key)
    if (pt !== 0) factors.push({ key, label: factorLabel(key), pt })
    activeKeys.push(key)
    total += pt
  }

  // ---- イベント
  for (const e of events) {
    if (targetDate < e.startDate || targetDate > e.endDate) continue
    const key = `event:${(e.expectedImpact ?? '').toLowerCase() || 'low'}`
    const pt = getCoefficient(coefficients, key)
    factors.push({ key, label: factorLabel(key), pt, detail: e.name ?? undefined })
    activeKeys.push(key)
    total += pt
  }

  // ---- 祝日・連休・特別期間・学校休暇
  if (holiday.known) {
    for (const key of holidayFactorKeys(holiday)) {
      const pt = getCoefficient(coefficients, key)
      const detail =
        key.startsWith('holiday:') && holiday.blockLength > 0
          ? `${holiday.blockLength}連休${holiday.holidayName ? `（${holiday.holidayName}）` : ''}`
          : undefined
      factors.push({ key, label: factorLabel(key), pt, detail })
      activeKeys.push(key)
      total += pt
    }
  }

  // ---- 天候（直前需要のみ）
  if (weather?.isRainy && leadDays <= 7) {
    const key = leadDays <= 3 ? 'weather:rain_lead0_3' : 'weather:rain_lead4_7'
    const pt = getCoefficient(coefficients, key)
    factors.push({
      key,
      label: factorLabel(key),
      pt,
      detail: weather.rainProbability != null ? `降水確率 ${weather.rainProbability}%` : undefined,
    })
    activeKeys.push(key)
    total += pt
  }

  // ---- 競合売止め（エリア逼迫）。比率 × 係数。半数以上が売止めなら未登録イベントの穴埋めにもなる
  if (input.competitorSoldOutShare != null && input.competitorSoldOutShare > 0) {
    const key = 'comp:soldout_share'
    const pt = getCoefficient(coefficients, key) * input.competitorSoldOutShare
    factors.push({ key, label: factorLabel(key), pt, detail: `競合の ${Math.round(input.competitorSoldOutShare * 100)}% が売止め` })
    activeKeys.push(key)
    total += pt
  }

  const unconstrained = Math.max(0, total)
  const predicted = Math.min(1, unconstrained)

  // ---- 信頼度（リードタイム区分別 MAPE から区間を作る。1.28σ ≒ 80% 区間）
  const bucket = leadBucket(leadDays)
  const mape = getCoefficient(coefficients, `calib:${bucket}`)
  const half = 1.28 * mape * Math.max(predicted, 0.2)
  const scalar = Math.min(0.95, Math.max(0.3, 1 - mape * 2))

  return {
    date: targetDate,
    leadDays,
    baseOccupancy: base,
    movingAverage,
    yearOverYear,
    unconstrainedOccupancy: unconstrained,
    predictedOccupancy: predicted,
    demandLevel: mapOccupancyToDemandLevel(predicted),
    demandFactors: factors,
    activeFactorKeys: activeKeys,
    confidence: {
      p50: predicted,
      p10: Math.max(0, predicted - half),
      p90: Math.min(1, predicted + half),
      scalar,
      leadBucket: bucket,
      mape,
    },
  }
}
