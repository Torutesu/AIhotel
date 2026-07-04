import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess, sendCreated, sendDeleted } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import {
  getPriceRanksService,
  createPriceRankService,
  updatePriceRankService,
  deletePriceRankService,
} from '../services/settingsService.js'

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
  const rank = await updatePriceRankService(req.params.id, hotelId, req.body)
  await writeAuditLog({
    tenantId: rank?.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'PriceRank',
    entityId: req.params.id,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, rank, 200, '料金ランクを更新しました')
})

/**
 * 料金ランク削除（MANAGER 以上・監査対象）
 * DELETE /api/v1/settings/price-ranks/:id?hotelId=
 */
export const deletePriceRank = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  await deletePriceRankService(req.params.id, hotelId)
  await writeAuditLog({
    userId: req.user!.userId,
    action: 'DELETE',
    entity: 'PriceRank',
    entityId: req.params.id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendDeleted(res)
})
