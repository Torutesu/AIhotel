import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess, sendCreated, sendDeleted } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import {
  getSpecialDaysService,
  createSpecialDayService,
  updateSpecialDayService,
  deleteSpecialDayService,
  getExternalFactorsService,
  createExternalFactorService,
  updateExternalFactorService,
  deleteExternalFactorService,
} from '../services/calendarService.js'
import type { ExternalFactorsQueryInput } from '../lib/validators.js'

/**
 * 特日一覧（F-DP-08）
 * GET /api/v1/calendar/special-days?hotelId=&startDate=&endDate=
 */
export const getSpecialDays = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, startDate, endDate } = req.query as unknown as {
    hotelId: string
    startDate: Date
    endDate: Date
  }
  const result = await getSpecialDaysService(hotelId, startDate, endDate)
  sendSuccess(res, result)
})

/**
 * 特日登録（MANAGER 以上・監査対象）
 * POST /api/v1/calendar/special-days
 */
export const createSpecialDay = asyncHandler(async (req: Request, res: Response) => {
  const created = await createSpecialDayService(req.body)
  await writeAuditLog({
    tenantId: created.tenantId,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'SpecialDay',
    entityId: created.id,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendCreated(res, created, '特日を登録しました')
})

/**
 * 特日更新（MANAGER 以上・監査対象）
 * PUT /api/v1/calendar/special-days/:id?hotelId=
 */
export const updateSpecialDay = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  const updated = await updateSpecialDayService(req.params.id, hotelId, req.body)
  await writeAuditLog({
    tenantId: updated?.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'SpecialDay',
    entityId: req.params.id,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, updated, 200, '特日を更新しました')
})

/**
 * 特日削除（MANAGER 以上・監査対象）
 * DELETE /api/v1/calendar/special-days/:id?hotelId=
 */
export const deleteSpecialDay = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  await deleteSpecialDayService(req.params.id, hotelId)
  await writeAuditLog({
    userId: req.user!.userId,
    action: 'DELETE',
    entity: 'SpecialDay',
    entityId: req.params.id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendDeleted(res)
})

/**
 * 外部要因一覧（F-EXT-01）
 * GET /api/v1/calendar/external-factors?hotelId=&startDate=&endDate=&category=
 */
export const getExternalFactors = asyncHandler(async (req: Request, res: Response) => {
  const result = await getExternalFactorsService(req.query as unknown as ExternalFactorsQueryInput)
  sendSuccess(res, result)
})

/**
 * 外部要因登録（OPERATOR も登録可 — イベント情報登録と同じ扱い。監査対象）
 * POST /api/v1/calendar/external-factors
 */
export const createExternalFactor = asyncHandler(async (req: Request, res: Response) => {
  const created = await createExternalFactorService(req.body)
  await writeAuditLog({
    tenantId: created.tenantId,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'ExternalFactor',
    entityId: created.id,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendCreated(res, created, '外部要因を登録しました')
})

/**
 * 外部要因更新（監査対象）
 * PUT /api/v1/calendar/external-factors/:id?hotelId=
 */
export const updateExternalFactor = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  const updated = await updateExternalFactorService(req.params.id, hotelId, req.body)
  await writeAuditLog({
    tenantId: updated?.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'ExternalFactor',
    entityId: req.params.id,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, updated, 200, '外部要因を更新しました')
})

/**
 * 外部要因削除（MANAGER 以上・監査対象）
 * DELETE /api/v1/calendar/external-factors/:id?hotelId=
 */
export const deleteExternalFactor = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  await deleteExternalFactorService(req.params.id, hotelId)
  await writeAuditLog({
    userId: req.user!.userId,
    action: 'DELETE',
    entity: 'ExternalFactor',
    entityId: req.params.id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendDeleted(res)
})
