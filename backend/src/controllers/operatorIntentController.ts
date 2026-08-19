import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import {
  createPriceDecisionService,
  listPriceDecisionsService,
} from '../services/operatorIntent/priceDecisionService.js'
import { getIntentVarianceService } from '../services/operatorIntent/varianceService.js'
import {
  getPreferenceProfilesService,
  recomputePreferenceProfilesService,
  setPreferenceProfileEnabledService,
} from '../services/operatorIntent/learningService.js'
import type {
  CreatePriceDecisionInput,
  PriceDecisionsQueryInput,
  RecomputePreferenceProfilesInput,
  UpdatePreferenceProfileInput,
} from '../lib/validators.js'

/**
 * 運営担当者の価格判断（意向）を記録する（F-DP-08・監査対象）
 * POST /api/v1/pricing/decisions
 */
export const createPriceDecision = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as CreatePriceDecisionInput
  const decision = await createPriceDecisionService(input, req.user!.userId)

  await writeAuditLog({
    tenantId: decision.tenantId,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'PriceDecision',
    entityId: decision.id,
    newValue: decision,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })

  sendSuccess(res, decision, 201, '価格判断を記録しました')
})

/**
 * 価格判断の履歴（F-DP-08）
 * GET /api/v1/pricing/decisions?hotelId=&startDate=&endDate=
 */
export const getPriceDecisions = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, startDate, endDate } = req.query as unknown as PriceDecisionsQueryInput
  const decisions = await listPriceDecisionsService(hotelId, startDate, endDate)
  sendSuccess(res, decisions)
})

/**
 * AI推奨と実際にやった値の差異レポート（F-DP-09）
 * GET /api/v1/pricing/variance?hotelId=&year=&month=
 */
export const getIntentVariance = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, year, month } = req.query as unknown as {
    hotelId: string
    year: number
    month: number
  }
  const result = await getIntentVarianceService(hotelId, year, month)
  sendSuccess(res, result)
})

/**
 * 学習済み意向プロファイル一覧（F-DP-10）
 * GET /api/v1/pricing/learning/profiles?hotelId=
 */
export const getPreferenceProfiles = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  const profiles = await getPreferenceProfilesService(hotelId)
  sendSuccess(res, profiles)
})

/**
 * 意向プロファイルの再学習（MANAGER以上・監査対象 — F-DP-10）
 * POST /api/v1/pricing/learning/recompute
 */
export const recomputePreferenceProfiles = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, lookbackDays } = req.body as RecomputePreferenceProfilesInput
  const result = await recomputePreferenceProfilesService(hotelId, lookbackDays)

  await writeAuditLog({
    tenantId: result.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'OperatorPreferenceProfile',
    entityId: hotelId,
    newValue: result,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })

  sendSuccess(
    res,
    result,
    200,
    `意向プロファイルを再学習しました（判断${result.sampleCount}件 / ${result.segmentCount}セグメント）`
  )
})

/**
 * 意向プロファイルの有効／無効切り替え（MANAGER以上・監査対象 — F-DP-10）
 * PATCH /api/v1/pricing/learning/profiles/:id
 */
export const updatePreferenceProfile = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string }
  const { hotelId, isEnabled } = req.body as UpdatePreferenceProfileInput

  const { before, after } = await setPreferenceProfileEnabledService(
    id,
    hotelId,
    isEnabled,
    req.user!.userId
  )

  await writeAuditLog({
    tenantId: after.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'OperatorPreferenceProfile',
    entityId: after.id,
    oldValue: before,
    newValue: after,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })

  sendSuccess(res, after, 200, isEnabled ? '意向補正を有効化しました' : '意向補正を無効化しました')
})
