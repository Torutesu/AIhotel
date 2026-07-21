import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess, sendCreated, sendDeleted } from '../utils/response.js'
import {
  getHotelsService,
  getHotelByIdService,
  createHotelService,
  updateHotelService,
  deleteHotelService,
} from '../services/hotelsService.js'
import { writeAuditLog } from '../services/auditService.js'

/**
 * ホテル一覧取得。ADMIN は全件、それ以外は自テナントのみ（C-3）
 * GET /api/v1/hotels
 */
export const getHotels = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!
  const tenantId = user.role === 'ADMIN' ? undefined : user.tenantId
  const hotels = await getHotelsService(tenantId)
  sendSuccess(res, hotels)
})

/**
 * ホテル詳細取得
 * GET /api/v1/hotels/:id
 */
export const getHotelById = asyncHandler(async (req: Request, res: Response) => {
  const hotel = await getHotelByIdService(req.params.id)
  sendSuccess(res, hotel)
})

/**
 * ホテル作成（ADMIN専用）
 * POST /api/v1/hotels
 */
export const createHotel = asyncHandler(async (req: Request, res: Response) => {
  const hotel = await createHotelService(req.body)
  await writeAuditLog({
    tenantId: hotel.tenantId,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'Hotel',
    entityId: hotel.id,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendCreated(res, hotel)
})

/**
 * ホテル更新（ADMIN専用）
 * PUT /api/v1/hotels/:id
 */
export const updateHotel = asyncHandler(async (req: Request, res: Response) => {
  const before = await getHotelByIdService(req.params.id)
  const hotel = await updateHotelService(req.params.id, req.body)
  await writeAuditLog({
    tenantId: hotel.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'Hotel',
    entityId: hotel.id,
    oldValue: before,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, hotel)
})

/**
 * ホテル削除・論理削除（ADMIN専用）
 * DELETE /api/v1/hotels/:id
 */
export const deleteHotel = asyncHandler(async (req: Request, res: Response) => {
  const before = await getHotelByIdService(req.params.id)
  await deleteHotelService(req.params.id)
  await writeAuditLog({
    tenantId: before.tenantId,
    userId: req.user!.userId,
    action: 'DELETE',
    entity: 'Hotel',
    entityId: req.params.id,
    oldValue: before,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendDeleted(res)
})
