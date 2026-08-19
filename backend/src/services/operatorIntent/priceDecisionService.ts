import { prisma } from '../../lib/prisma.js'
import { NotFoundError } from '../../middlewares/errorHandler.js'
import type { PriceDecisionType, PriceIntentReason } from '@prisma/client'

// 運営担当者の意向の記録（F-DP-08）。
//
// 「AIが推奨した価格」と「運営担当者が実際に適用した価格」の差異を後から追跡する
// ための追記専用ログ。AiPriceRecommendation は再計算のたびに上書きされるため、
// 判断した時点の推奨値をこのレコードにスナップショットとして焼き込む。

/**
 * 判断種別を AI推奨との差から導出する。
 * クライアントから受け取った値は使わない（差異の正しさが監査・学習の前提になるため）。
 * ランクが両方揃っていればランクで、揃っていなければ価格で比較する。
 */
export function deriveDecisionType(params: {
  aiRecommendedRank?: number | null
  appliedRank?: number | null
  aiRecommendedPrice?: number | null
  appliedPrice?: number | null
}): PriceDecisionType {
  const { aiRecommendedRank, appliedRank, aiRecommendedPrice, appliedPrice } = params

  const byRank =
    aiRecommendedRank != null && appliedRank != null ? appliedRank - aiRecommendedRank : null
  const byPrice =
    aiRecommendedPrice != null && appliedPrice != null ? appliedPrice - aiRecommendedPrice : null

  const delta = byRank ?? byPrice
  if (delta == null || delta === 0) return 'ACCEPTED'
  return delta > 0 ? 'RAISED' : 'LOWERED'
}

export interface CreatePriceDecisionInput {
  hotelId: string
  date: Date
  roomTypeId?: string
  appliedRank?: number
  appliedPrice?: number
  intentReason: PriceIntentReason
  intentNote?: string
}

function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/**
 * 運営担当者の価格判断を記録する（F-DP-08）。
 * 判断時点のAI推奨をスナップショットとして保存し、判断種別をサーバ側で導出する。
 */
export async function createPriceDecisionService(
  input: CreatePriceDecisionInput,
  decidedByUserId: string
) {
  const hotel = await prisma.hotel.findUnique({ where: { id: input.hotelId } })
  if (!hotel) throw new NotFoundError('ホテル')

  const date = dateOnly(input.date)
  const roomTypeId = input.roomTypeId ?? null

  // AiPriceRecommendation は roomTypeId が NULL の行を持つため findUnique は使えない
  // （SQL では NULL 同士が等しいと評価されない）
  const recommendation = await prisma.aiPriceRecommendation.findFirst({
    where: { hotelId: input.hotelId, date, roomTypeId },
  })

  // 適用価格が省略された場合は料金ランクマスタから解決する
  let appliedPrice = input.appliedPrice ?? null
  if (appliedPrice == null && input.appliedRank != null) {
    const rank = await prisma.priceRank.findUnique({
      where: { hotelId_rank: { hotelId: input.hotelId, rank: input.appliedRank } },
    })
    appliedPrice = rank?.price1P ?? null
  }

  const decisionType = deriveDecisionType({
    aiRecommendedRank: recommendation?.recommendedRank,
    appliedRank: input.appliedRank ?? null,
    aiRecommendedPrice: recommendation?.recommendedPrice,
    appliedPrice,
  })

  return prisma.priceDecision.create({
    data: {
      tenantId: hotel.tenantId,
      hotelId: input.hotelId,
      roomTypeId,
      date,
      aiRecommendedRank: recommendation?.recommendedRank ?? null,
      aiRecommendedPrice: recommendation?.recommendedPrice ?? null,
      aiPredictedOccupancy: recommendation?.predictedOccupancy ?? null,
      aiPredictedAdr: recommendation?.predictedAdr ?? null,
      aiDemandLevel: recommendation?.demandLevel ?? null,
      aiConfidence: recommendation?.confidence ?? null,
      aiModelVersion: recommendation?.modelVersion ?? null,
      appliedRank: input.appliedRank ?? null,
      appliedPrice,
      decisionType,
      intentReason: input.intentReason,
      intentNote: input.intentNote ?? null,
      decidedByUserId,
    },
    include: { decidedBy: { select: { id: true, name: true, role: true } } },
  })
}

/**
 * 期間内の価格判断履歴を新しい順に返す（F-DP-08）
 */
export async function listPriceDecisionsService(
  hotelId: string,
  startDate?: Date,
  endDate?: Date
) {
  const dateFilter =
    startDate || endDate
      ? {
          ...(startDate ? { gte: dateOnly(startDate) } : {}),
          ...(endDate ? { lte: dateOnly(endDate) } : {}),
        }
      : undefined

  return prisma.priceDecision.findMany({
    where: { hotelId, ...(dateFilter ? { date: dateFilter } : {}) },
    orderBy: [{ date: 'desc' }, { decidedAt: 'desc' }],
    include: { decidedBy: { select: { id: true, name: true, role: true } } },
  })
}
