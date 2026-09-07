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
import { getVenuesService, createVenueService, updateVenueService, deleteVenueService } from '../services/events/venueService.js'
import { detectEventCandidatesService, getEventCandidatesService, reviewEventCandidateService } from '../services/events/eventDetectionService.js'
import { extractVenueEventsService } from '../services/events/venueExtractionService.js'
import type { ReviewEventCandidateInput } from '../lib/validators.js'

/**
 * イベント一覧（F-DP-07）
 * GET /api/v1/events?hotelId=&startDate=&endDate=
 */
export const getEvents = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, startDate, endDate, status } = req.query as unknown as {
    hotelId: string
    startDate?: Date
    endDate?: Date
    status?: 'confirmed' | 'candidate' | 'rejected' | 'all'
  }
  const result = await getEventsService(hotelId, startDate, endDate, status)
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

// ======================================
// 会場マスタ（docs/外部要因設計.md §3 #3）
// ======================================

/** GET /api/v1/events/venues?hotelId= */
export const getVenues = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  sendSuccess(res, await getVenuesService(hotelId))
})

/** POST /api/v1/events/venues（MANAGER 以上・監査対象） */
export const createVenue = asyncHandler(async (req: Request, res: Response) => {
  const venue = await createVenueService(req.body)
  await writeAuditLog({
    tenantId: venue.tenantId,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'Venue',
    entityId: venue.id,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendCreated(res, venue, '会場を登録しました')
})

/** PUT /api/v1/events/venues/:id?hotelId= */
export const updateVenue = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  const venue = await updateVenueService(req.params.id, hotelId, req.body)
  await writeAuditLog({
    tenantId: venue?.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'Venue',
    entityId: req.params.id,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, venue, 200, '会場を更新しました')
})

/** DELETE /api/v1/events/venues/:id?hotelId= */
export const deleteVenue = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  await deleteVenueService(req.params.id, hotelId)
  await writeAuditLog({
    tenantId: req.user!.tenantId,
    userId: req.user!.userId,
    action: 'DELETE',
    entity: 'Venue',
    entityId: req.params.id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendDeleted(res, '会場を削除しました')
})

/** POST /api/v1/events/venues/:id/extract — 会場ページから LLM（Claude / GPT）でイベント候補を抽出（MANAGER 以上） */
export const extractVenueEvents = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, llmProvider, llmModel } = req.body as { hotelId: string; llmProvider?: 'anthropic' | 'openai'; llmModel?: string }
  const result = await extractVenueEventsService(req.params.id, hotelId, req.user!.userId, undefined, undefined, {
    provider: llmProvider,
    model: llmModel,
  })
  await writeAuditLog({
    tenantId: req.user!.tenantId,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'Event',
    entityId: req.params.id,
    newValue: result,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, result, 200, `${result.created}件のイベント候補を作成しました`)
})

// ======================================
// イベント候補（自動検出・承認）
// ======================================

/** GET /api/v1/events/candidates?hotelId= */
export const getEventCandidates = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  sendSuccess(res, await getEventCandidatesService(hotelId))
})

/** POST /api/v1/events/candidates/detect — 前年の稼働残差から候補を検出（MANAGER 以上） */
export const detectEventCandidates = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, lookbackDays } = req.body as { hotelId: string; lookbackDays?: number }
  const result = await detectEventCandidatesService(hotelId, req.user!.userId, lookbackDays)
  await writeAuditLog({
    tenantId: result.tenantId,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'Event',
    entityId: hotelId,
    newValue: result,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, result, 200, `${result.created}件のイベント候補を作成しました`)
})

/** POST /api/v1/events/candidates/:id/review — 承認/却下（MANAGER 以上） */
export const reviewEventCandidate = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, decision, ...overrides } = req.body as ReviewEventCandidateInput
  const event = await reviewEventCandidateService(req.params.id, hotelId, decision, overrides)
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
  sendSuccess(res, event, 200, decision === 'approve' ? 'イベントを承認しました' : 'イベント候補を却下しました')
})
