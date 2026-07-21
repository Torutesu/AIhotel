import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess, sendCreated, sendDeleted } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import {
  getEventsService,
  createEventService,
  updateEventService,
  deleteEventService,
} from '../services/eventsService.js'

/**
 * イベント一覧（F-DP-07）
 * GET /api/v1/events?hotelId=&startDate=&endDate=
 */
export const getEvents = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, startDate, endDate } = req.query as unknown as {
    hotelId: string
    startDate?: Date
    endDate?: Date
  }
  const result = await getEventsService(hotelId, startDate, endDate)
  sendSuccess(res, result)
})

/**
 * イベント登録（オペレーターも登録可・監査対象 — F-DP-07）
 * POST /api/v1/events
 */
export const createEvent = asyncHandler(async (req: Request, res: Response) => {
  const event = await createEventService(req.body, req.user!.userId)
  await writeAuditLog({
    tenantId: event.tenantId,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'Event',
    entityId: event.id,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendCreated(res, event)
})

/**
 * イベント更新（監査対象）
 * PUT /api/v1/events/:id?hotelId=
 */
export const updateEvent = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  const event = await updateEventService(req.params.id, hotelId, req.body)
  await writeAuditLog({
    tenantId: event?.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'Event',
    entityId: req.params.id,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, event, 200, 'イベントを更新しました')
})

/**
 * イベント削除（監査対象）
 * DELETE /api/v1/events/:id?hotelId=
 */
export const deleteEvent = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  await deleteEventService(req.params.id, hotelId)
  await writeAuditLog({
    userId: req.user!.userId,
    action: 'DELETE',
    entity: 'Event',
    entityId: req.params.id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendDeleted(res)
})
