import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireRole, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import {
  hotelIdQuerySchema,
  createPriceRankSchema,
  updatePriceRankSchema,
  updateHotelSettingsSchema,
  upsertForecastModelConfigSchema,
  createOutOfOrderRoomSchema,
  updateOutOfOrderRoomSchema,
  outOfOrderRoomsQuerySchema,
} from '../lib/validators.js'
import {
  getPriceRanks,
  createPriceRank,
  updatePriceRank,
  deletePriceRank,
  updateHotelSettings,
  getForecastModelConfigs,
  upsertForecastModelConfig,
  deleteForecastModelConfig,
  getOutOfOrderRooms,
  createOutOfOrderRoom,
  updateOutOfOrderRoom,
  deleteOutOfOrderRoom,
} from '../controllers/settingsController.js'

export const settingsRouter: ExpressRouter = Router()

// 全エンドポイント認証必須（C-2）
settingsRouter.use(authenticate)

// GET /api/v1/settings/price-ranks?hotelId=
settingsRouter.get(
  '/price-ranks',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(hotelIdQuerySchema, 'query'),
  getPriceRanks
)

// 設定変更は MANAGER 以上（要件定義書 §4）
settingsRouter.post(
  '/price-ranks',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(createPriceRankSchema),
  createPriceRank
)

settingsRouter.put(
  '/price-ranks/:id',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(updatePriceRankSchema),
  updatePriceRank
)

settingsRouter.delete(
  '/price-ranks/:id',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  deletePriceRank
)

// PUT /api/v1/settings/hotel/:id — ホテル設定（名称・週末定義等）変更は MANAGER 以上（F-SET-01）
settingsRouter.put(
  '/hotel/:id',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.params.id),
  validate(updateHotelSettingsSchema),
  updateHotelSettings
)

// ---- 予測モデル設定（ホテル×年 — 「場所や年でロジックが変わる」対応） ----

// GET /api/v1/settings/forecast-model-configs?hotelId=
settingsRouter.get(
  '/forecast-model-configs',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(hotelIdQuerySchema, 'query'),
  getForecastModelConfigs
)

settingsRouter.put(
  '/forecast-model-configs',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(upsertForecastModelConfigSchema),
  upsertForecastModelConfig
)

settingsRouter.delete(
  '/forecast-model-configs/:id',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(hotelIdQuerySchema, 'query'),
  deleteForecastModelConfig
)

// ---- 故障部屋（Out of Order） ----

// GET /api/v1/settings/out-of-order-rooms?hotelId=&startDate=&endDate=
settingsRouter.get(
  '/out-of-order-rooms',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(outOfOrderRoomsQuerySchema, 'query'),
  getOutOfOrderRooms
)

settingsRouter.post(
  '/out-of-order-rooms',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(createOutOfOrderRoomSchema),
  createOutOfOrderRoom
)

settingsRouter.put(
  '/out-of-order-rooms/:id',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(updateOutOfOrderRoomSchema),
  updateOutOfOrderRoom
)

settingsRouter.delete(
  '/out-of-order-rooms/:id',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  deleteOutOfOrderRoom
)
