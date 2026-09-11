import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess, sendCreated, sendDeleted } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import {
  getPriceRanksService,
  createPriceRankService,
  updatePriceRankService,
  deletePriceRankService,
  updateHotelSettingsService,
  getMonthlyBudgetsService,
  upsertMonthlyBudgetsService,
} from '../services/settingsService.js'
import type { UpsertBudgetsInput } from '../lib/validators.js'

/**
 * 料金ランク一覧
 * GET /api/v1/settings/price-ranks?hotelId=
 */
export const getPriceRanks = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  const result = await getPriceRanksService(hotelId)
  sendSuccess(res, result)
})

/**
 * 料金ランク作成（MANAGER 以上・監査対象）
 * POST /api/v1/settings/price-ranks
 */
export const createPriceRank = asyncHandler(async (req: Request, res: Response) => {
  const rank = await createPriceRankService(req.body)
  await writeAuditLog({
    tenantId: rank.tenantId,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'PriceRank',
    entityId: rank.id,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendCreated(res, rank)
})

/**
 * 料金ランク更新（MANAGER 以上・監査対象）
 * PUT /api/v1/settings/price-ranks/:id?hotelId=
 */
export const updatePriceRank = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  const { before, after } = await updatePriceRankService(req.params.id, hotelId, req.body)
  await writeAuditLog({
    tenantId: before.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'PriceRank',
    entityId: req.params.id,
    oldValue: before,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, after, 200, '料金ランクを更新しました')
})

/**
 * 料金ランク削除（MANAGER 以上・監査対象）
 * DELETE /api/v1/settings/price-ranks/:id?hotelId=
 */
export const deletePriceRank = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  const deleted = await deletePriceRankService(req.params.id, hotelId)
  await writeAuditLog({
    tenantId: deleted.tenantId,
    userId: req.user!.userId,
    action: 'DELETE',
    entity: 'PriceRank',
    entityId: req.params.id,
    oldValue: deleted,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendDeleted(res)
})

/**
 * ホテル設定更新（MANAGER 以上・監査対象 — F-SET-01）
 * PUT /api/v1/settings/hotel/:id
 */
export const updateHotelSettings = asyncHandler(async (req: Request, res: Response) => {
  const { before, after } = await updateHotelSettingsService(req.params.id, req.body)
  await writeAuditLog({
    tenantId: before.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'Hotel',
    entityId: after.id,
    oldValue: before,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, after, 200, 'ホテル設定を更新しました')
})

/**
 * 月次予算の取得（N-1 / F-SET-04）
 * GET /api/v1/settings/budgets?hotelId=&year=
 * 1〜12月ぶんを必ず返す（未登録の月は budget: null）
 */
export const getBudgets = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, year } = req.query as unknown as { hotelId: string; year: number }
  const result = await getMonthlyBudgetsService(hotelId, year)
  sendSuccess(res, result)
})

/**
 * 月次予算の年単位一括更新（MANAGER 以上・監査対象 — N-1 / F-SET-04）
 * PUT /api/v1/settings/budgets
 */
export const putBudgets = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as UpsertBudgetsInput
  const { tenantId, before, after } = await upsertMonthlyBudgetsService(input)
  await writeAuditLog({
    tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'MonthlyBudget',
    entityId: `${input.hotelId}:${input.year}`,
    oldValue: before,
    newValue: after,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, after, 200, '予算を更新しました')
})
