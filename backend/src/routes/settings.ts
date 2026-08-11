import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireRole, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import {
  hotelIdQuerySchema,
  createPriceRankSchema,
  updatePriceRankSchema,
  updateHotelSettingsSchema,
  segmentsQuerySchema,
  upsertSegmentsSchema,
} from '../lib/validators.js'
import {
  getPriceRanks,
  createPriceRank,
  updatePriceRank,
  deletePriceRank,
  updateHotelSettings,
  getSegments,
  upsertSegments,
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

// GET /api/v1/settings/segments?hotelId=&kind= — セグメントマスタ一覧（F-SET-06）
settingsRouter.get(
  '/segments',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(segmentsQuerySchema, 'query'),
  getSegments
)

// PUT /api/v1/settings/segments — セグメントマスタ一括upsert（MANAGER 以上・監査対象 — F-SET-06）
settingsRouter.put(
  '/segments',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(upsertSegmentsSchema),
  upsertSegments
)

// PUT /api/v1/settings/hotel/:id — ホテル設定（名称・週末定義等）変更は MANAGER 以上（F-SET-01）
settingsRouter.put(
  '/hotel/:id',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.params.id),
  validate(updateHotelSettingsSchema),
  updateHotelSettings
)
