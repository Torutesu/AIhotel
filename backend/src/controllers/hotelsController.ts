import type { Request, Response } from 'express'
import { ApiError, BadRequestError, asyncHandler } from '../middlewares/errorHandler.js'
import type { CreateHotelInput } from '../lib/validators.js'
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
 * ホテル一覧取得。運営（PLATFORM_ADMIN）は全件、それ以外は自テナントのみ（C-3 / #62）
 * GET /api/v1/hotels
 */
export const getHotels = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!
  const hotels = await getHotelsService({ role: user.role, tenantId: user.tenantId })
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
 * ホテル作成（ADMIN / 運営 — #62）
 * POST /api/v1/hotels
 *
 * tenantId はリクエストボディからは受け取らず、原則として呼び出し元トークンの
 * tenantId を使う。テナント管理者（ADMIN）が他テナントにホテルを作れないようにするため。
 * 運営（PLATFORM_ADMIN）は自身の tenantId を持たないので、ボディの tenantId を
 * このロールに限り許可する。
 */
export const createHotel = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId: requestedTenantId, ...hotelInput } = req.body as CreateHotelInput
  const actor = req.user!
  const isPlatformAdmin = actor.role === 'PLATFORM_ADMIN'

  if (requestedTenantId !== undefined && !isPlatformAdmin) {
    throw new ApiError(403, 'テナントを指定してホテルを作成できるのは運営のみです')
  }

  const tenantId = isPlatformAdmin ? requestedTenantId : actor.tenantId
  if (!tenantId) {
    throw new BadRequestError(
      isPlatformAdmin
        ? 'テナントIDは必須です'
        : 'テナントに所属していないため、ホテルを作成できません'
    )
  }

  const hotel = await createHotelService({ ...hotelInput, tenantId })
  await writeAuditLog({
    tenantId: hotel.tenantId,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'Hotel',
    entityId: hotel.id,
    newValue: { ...hotelInput, tenantId },
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
