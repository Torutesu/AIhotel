import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendCreated, sendDeleted, sendSuccess } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import {
  createNewHotelService,
  deleteNewHotelService,
  importNewHotelsService,
  listNewHotelsService,
  updateNewHotelService,
} from '../services/newHotelsService.js'
import type { ImportNewHotelsInput } from '../lib/validators.js'

// 周辺の新規ホテル（外部需要動向 — 2026-10）。変更系はすべて監査ログに残す

/** GET /api/v1/new-hotels?hotelId= */
export const listNewHotels = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  sendSuccess(res, await listNewHotelsService(hotelId))
})

/** POST /api/v1/new-hotels */
export const createNewHotel = asyncHandler(async (req: Request, res: Response) => {
  const created = await createNewHotelService(req.body, req.user!.userId)
  await writeAuditLog({
    tenantId: created.tenantId,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'NewHotelOpening',
    entityId: created.id,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendCreated(res, created)
})

/** PUT /api/v1/new-hotels/:id?hotelId= */
export const updateNewHotel = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  const { before, after } = await updateNewHotelService(req.params.id, hotelId, req.body)
  await writeAuditLog({
    tenantId: before.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'NewHotelOpening',
    entityId: req.params.id,
    oldValue: before,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, after, 200, '新規ホテルを更新しました')
})

/** DELETE /api/v1/new-hotels/:id?hotelId= */
export const deleteNewHotel = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  const deleted = await deleteNewHotelService(req.params.id, hotelId)
  await writeAuditLog({
    tenantId: deleted.tenantId,
    userId: req.user!.userId,
    action: 'DELETE',
    entity: 'NewHotelOpening',
    entityId: req.params.id,
    oldValue: deleted,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendDeleted(res, '新規ホテルを削除しました')
})

/** POST /api/v1/new-hotels/import — 規定フォーム（CSV）の取り込み */
export const importNewHotels = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as ImportNewHotelsInput
  const { tenantId, ...result } = await importNewHotelsService(input, req.user!.userId)
  if (!result.dryRun) {
    await writeAuditLog({
      tenantId,
      userId: req.user!.userId,
      action: 'CREATE',
      entity: 'NewHotelOpening',
      entityId: input.hotelId,
      newValue: { import: 'new-hotels', ...result },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }
  const verb = result.dryRun ? '確認しました' : '取り込みました'
  sendSuccess(res, result, 200, `新規ホテル ${result.total}件を${verb}（新規 ${result.created} / 更新 ${result.updated}）`)
})
