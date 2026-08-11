import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'
import { logger } from '../../utils/logger.js'
import {
  buildFeatureVector,
  splitByTime,
  FEATURE_NAMES,
  type TrainingSample,
} from './features.js'
import {
  loadFeatureSourceData,
  buildFeatureContext,
  actualOccupancyOf,
  type FeatureSourceData,
} from './featureContextService.js'
import { ridgeTrainer } from './models/ridge.js'
import { gbmTrainer } from './models/gbm.js'
import type { TrainedModel, Trainer } from './models/types.js'

// ======================================
// 需要予測モデルの学習（4E-2 — docs/ai-agent-design.md §2）
//
// Ridge と GBM を同じ特徴量・同じ分割で学習し、検証誤差の小さい方を採用する。
// どちらが勝つかはデータ次第で事前に決められないため、毎日の学習で実測させる。
// ======================================

const TRAINERS: Trainer[] = [ridgeTrainer, gbmTrainer]

/**
 * 1つの宿泊日から、複数のリードタイムぶんのサンプルを作る。
 *
 * 「1日 = 1サンプル」にすると1年で365行しか集まらないが、
 * 同じ宿泊日を「7日前から見た場合」「30日前から見た場合」…と展開すれば
 * 数千サンプルになる。しかもリードタイムは特徴量なので、
 * モデルは予測地平ごとの振る舞いを学習できる（近いほどオンハンドを信じる等）。
 */
export const TRAINING_LEAD_TIMES = [1, 3, 7, 14, 21, 30, 45, 60, 90, 120, 180] as const

/** 学習に使う過去期間。構造変化（コロナ・インバウンド回復）を跨がないよう絞る */
const TRAINING_WINDOW_DAYS = 730

const MS_PER_DAY = 86_400_000

function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * MS_PER_DAY)
}

/**
 * 学習サンプルを組み立てる。
 * 実績が確定している宿泊日だけを対象にし、各リードタイムぶんに展開する。
 */
export function buildTrainingSamples(
  data: FeatureSourceData,
  stayDates: Date[],
  leadTimes: readonly number[] = TRAINING_LEAD_TIMES
): TrainingSample[] {
  const samples: TrainingSample[] = []
  for (const stayDate of stayDates) {
    const target = actualOccupancyOf(data, stayDate)
    if (target == null) continue

    for (const leadTime of leadTimes) {
      const predictedAt = addDays(stayDate, -leadTime)
      const context = buildFeatureContext(data, stayDate, predictedAt)
      samples.push({
        features: buildFeatureVector(context),
        target,
        stayDate,
      })
    }
  }
  return samples
}

export interface TrainingResult {
  hotelId: string
  tenantId: string
  modelVersion: string
  algorithm: string
  sampleCount: number
  validationMae: number
  /** 採用されなかった方の結果も残す（なぜその選択になったかを説明できるように） */
  candidates: Array<{ algorithm: string; validationMae: number | null }>
  trainedAt: string
}

/**
 * 学習して結果をDBに保存する。
 * 学習できるだけのデータが無い場合は null を返す（ルールベースのまま運用する）。
 */
export async function trainDemandModelService(
  hotelId: string,
  now = new Date()
): Promise<TrainingResult | null> {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const today = dateOnly(now)
  const windowStart = addDays(today, -TRAINING_WINDOW_DAYS)

  // 実績が確定している宿泊日（= 学習対象）を集める
  const stayDateRows = await prisma.reservationNight.groupBy({
    by: ['stayDate'],
    where: { hotelId, stayDate: { gte: windowStart, lt: today }, isDayUse: false },
    orderBy: { stayDate: 'asc' },
  })
  if (stayDateRows.length === 0) return null

  const stayDates = stayDateRows.map((r) => r.stayDate)
  const data = await loadFeatureSourceData(hotelId, stayDates[0], stayDates[stayDates.length - 1])
  const samples = buildTrainingSamples(data, stayDates)
  if (samples.length === 0) return null

  // 分割は必ず時間順。ランダム分割は未来で過去を予測する形になる
  const { train, validation } = splitByTime(samples, 0.2)

  const candidates: Array<{ algorithm: string; validationMae: number | null }> = []
  let best: TrainedModel | null = null
  for (const trainer of TRAINERS) {
    const model = trainer.train(train, validation)
    candidates.push({ algorithm: trainer.algorithm, validationMae: model?.validationMae ?? null })
    if (model && (!best || model.validationMae < best.validationMae)) best = model
  }

  if (!best) {
    logger.warn(
      { hotelId, sampleCount: samples.length },
      '需要予測モデルを学習できませんでした（データ不足）'
    )
    return null
  }

  const modelVersion = `${best.algorithm}-v1`

  // 過去のモデルは履歴として残し、有効なのは1件だけにする
  await prisma.$transaction([
    prisma.forecastModel.updateMany({
      where: { hotelId, isActive: true },
      data: { isActive: false },
    }),
    prisma.forecastModel.create({
      data: {
        tenantId: hotel.tenantId,
        hotelId,
        modelVersion,
        algorithm: best.algorithm,
        sampleCount: best.sampleCount,
        validationMae: best.validationMae,
        featureNames: [...FEATURE_NAMES] as unknown as Prisma.InputJsonValue,
        featureImportance: best.featureImportance as unknown as Prisma.InputJsonValue,
        params: best.params as Prisma.InputJsonValue,
        candidates: candidates as unknown as Prisma.InputJsonValue,
        isActive: true,
      },
    }),
  ])

  logger.info(
    {
      hotelId,
      algorithm: best.algorithm,
      sampleCount: best.sampleCount,
      validationMae: best.validationMae,
      candidates,
    },
    '需要予測モデルを学習しました'
  )

  return {
    hotelId,
    tenantId: hotel.tenantId,
    modelVersion,
    algorithm: best.algorithm,
    sampleCount: best.sampleCount,
    validationMae: best.validationMae,
    candidates,
    trainedAt: new Date().toISOString(),
  }
}

/** 現在有効な学習済みモデルを取り出す。無ければ null（ルールベースへフォールバック） */
export async function loadActiveModel(hotelId: string): Promise<TrainedModel | null> {
  const row = await prisma.forecastModel.findFirst({
    where: { hotelId, isActive: true },
    orderBy: { createdAt: 'desc' },
  })
  if (!row) return null

  return {
    algorithm: row.algorithm as TrainedModel['algorithm'],
    sampleCount: row.sampleCount,
    validationMae: row.validationMae,
    featureImportance: (row.featureImportance as number[] | null) ?? [],
    params: row.params,
  }
}

/** アルゴリズム名から予測器を引く */
export function trainerFor(algorithm: string): Trainer | null {
  return TRAINERS.find((t) => t.algorithm === algorithm) ?? null
}
