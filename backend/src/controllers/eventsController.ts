import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess, sendCreated, sendDeleted } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import {
  getEventsService,
  createEventService,
  updateEventService,
  deleteEventService,
  importEventsService,
} from '../services/eventsService.js'
import type { ImportEventsInput } from '../lib/validators.js'

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
  const { before, after } = await updateEventService(req.params.id, hotelId, req.body)
  await writeAuditLog({
    tenantId: before.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'Event',
    entityId: req.params.id,
    oldValue: before,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, after, 200, 'イベントを更新しました')
})

/**
 * イベント削除（監査対象）
 * DELETE /api/v1/events/:id?hotelId=
 */
export const deleteEvent = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  const deleted = await deleteEventService(req.params.id, hotelId)
  await writeAuditLog({
    tenantId: deleted.tenantId,
    userId: req.user!.userId,
    action: 'DELETE',
    entity: 'Event',
    entityId: req.params.id,
    oldValue: deleted,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendDeleted(res)
})

/**
 * イベントの取り込み（外部需要動向の規定フォーム — 2026-10。監査対象）
 * POST /api/v1/events/import
 */
export const importEvents = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as ImportEventsInput
  const { tenantId, ...result } = await importEventsService(input, req.user!.userId)
  if (!result.dryRun) {
    await writeAuditLog({
      tenantId,
      userId: req.user!.userId,
      action: 'CREATE',
      entity: 'Event',
      entityId: input.hotelId,
      newValue: { import: 'events', ...result },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }
  const verb = result.dryRun ? '確認しました' : '取り込みました'
  sendSuccess(res, result, 200, `イベント ${result.total}件を${verb}（新規 ${result.created} / 更新 ${result.updated}）`)
})
