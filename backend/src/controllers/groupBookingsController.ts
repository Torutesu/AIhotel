import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess, sendCreated, sendDeleted } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import {
  listGroupBookingPresets,
  listGroupBookingsService,
  createGroupBookingService,
  updateGroupBookingService,
  deleteGroupBookingService,
} from '../services/groupBookingService.js'

// 団体客の登録（SAAS_DECISIONS.md D-09 / F-SET-05）

/** GET /api/v1/group-bookings/presets — 影響ルールの選択肢（システム固定） */
export const getPresets = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, listGroupBookingPresets())
})

/** GET /api/v1/group-bookings?hotelId=&startDate=&endDate= */
export const listGroupBookings = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, startDate, endDate } = req.query as unknown as {
    hotelId: string
    startDate?: Date
    endDate?: Date
  }
  sendSuccess(res, await listGroupBookingsService(hotelId, { startDate, endDate }))
})

/** POST /api/v1/group-bookings（MANAGER 以上・監査対象） */
export const createGroupBooking = asyncHandler(async (req: Request, res: Response) => {
  const booking = await createGroupBookingService(req.body)
  await writeAuditLog({
    tenantId: booking.tenantId,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'GroupBooking',
    entityId: booking.id,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendCreated(res, booking)
})

/** PUT /api/v1/group-bookings/:id?hotelId=（MANAGER 以上・監査対象） */
export const updateGroupBooking = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  const booking = await updateGroupBookingService(req.params.id, hotelId, req.body)
  await writeAuditLog({
    tenantId: booking?.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'GroupBooking',
    entityId: req.params.id,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, booking, 200, '団体予約を更新しました')
})

/** DELETE /api/v1/group-bookings/:id?hotelId=（MANAGER 以上・監査対象） */
export const deleteGroupBooking = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  await deleteGroupBookingService(req.params.id, hotelId)
  await writeAuditLog({
    tenantId: req.user!.tenantId,
    userId: req.user!.userId,
    action: 'DELETE',
    entity: 'GroupBooking',
    entityId: req.params.id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendDeleted(res)
})
