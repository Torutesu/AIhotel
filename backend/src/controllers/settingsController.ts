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
  getForecastModelConfigsService,
  upsertForecastModelConfigService,
  deleteForecastModelConfigService,
  getOutOfOrderRoomsService,
  createOutOfOrderRoomService,
  updateOutOfOrderRoomService,
  deleteOutOfOrderRoomService,
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

/**
 * ホテル設定更新（MANAGER 以上・監査対象 — F-SET-01）
 * PUT /api/v1/settings/hotel/:id
 */
export const updateHotelSettings = asyncHandler(async (req: Request, res: Response) => {
  const hotel = await updateHotelSettingsService(req.params.id, req.body)
  await writeAuditLog({
    tenantId: hotel.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'Hotel',
    entityId: hotel.id,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, hotel, 200, 'ホテル設定を更新しました')
})

/**
 * 予測モデル設定一覧
 * GET /api/v1/settings/forecast-model-configs?hotelId=
 */
export const getForecastModelConfigs = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  const result = await getForecastModelConfigsService(hotelId)
  sendSuccess(res, result)
})

/**
 * 予測モデル設定のアップサート（MANAGER 以上・監査対象）
 * PUT /api/v1/settings/forecast-model-configs
 */
export const upsertForecastModelConfig = asyncHandler(async (req: Request, res: Response) => {
  const config = await upsertForecastModelConfigService(req.body, req.user!.userId)
  await writeAuditLog({
    tenantId: config.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'ForecastModelConfig',
    entityId: config.id,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, config, 200, '予測モデル設定を保存しました')
})

/**
 * 予測モデル設定削除（MANAGER 以上・監査対象）
 * DELETE /api/v1/settings/forecast-model-configs/:id?hotelId=
 */
export const deleteForecastModelConfig = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  await deleteForecastModelConfigService(req.params.id, hotelId)
  await writeAuditLog({
    userId: req.user!.userId,
    action: 'DELETE',
    entity: 'ForecastModelConfig',
    entityId: req.params.id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendDeleted(res)
})

/**
 * 故障部屋一覧
 * GET /api/v1/settings/out-of-order-rooms?hotelId=&startDate=&endDate=
 */
export const getOutOfOrderRooms = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, startDate, endDate } = req.query as unknown as {
    hotelId: string
    startDate?: Date
    endDate?: Date
  }
  const result = await getOutOfOrderRoomsService(hotelId, startDate, endDate)
  sendSuccess(res, result)
})

/**
 * 故障部屋登録（MANAGER 以上・監査対象）
 * POST /api/v1/settings/out-of-order-rooms
 */
export const createOutOfOrderRoom = asyncHandler(async (req: Request, res: Response) => {
  const record = await createOutOfOrderRoomService(req.body)
  await writeAuditLog({
    tenantId: record.tenantId,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'OutOfOrderRoom',
    entityId: record.id,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendCreated(res, record)
})

/**
 * 故障部屋更新（MANAGER 以上・監査対象）
 * PUT /api/v1/settings/out-of-order-rooms/:id?hotelId=
 */
export const updateOutOfOrderRoom = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  const record = await updateOutOfOrderRoomService(req.params.id, hotelId, req.body)
  await writeAuditLog({
    tenantId: record?.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'OutOfOrderRoom',
    entityId: req.params.id,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, record, 200, '故障部屋設定を更新しました')
})

/**
 * 故障部屋削除（MANAGER 以上・監査対象）
 * DELETE /api/v1/settings/out-of-order-rooms/:id?hotelId=
 */
export const deleteOutOfOrderRoom = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  await deleteOutOfOrderRoomService(req.params.id, hotelId)
  await writeAuditLog({
    userId: req.user!.userId,
    action: 'DELETE',
    entity: 'OutOfOrderRoom',
    entityId: req.params.id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendDeleted(res)
})
