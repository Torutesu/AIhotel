import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireRole, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import {
  hotelIdQuerySchema,
  yearQuerySchema,
  idParamSchema,
  createPriceRankSchema,
  updatePriceRankSchema,
  updateHotelSettingsSchema,
  upsertBudgetsSchema,
  createCompetitorSchema,
  updateCompetitorSchema,
  createRoomTypeSchema,
  updateRoomTypeSchema,
  upsertIntegrationSchema,
  integrationKindParamSchema,
  copyHotelSettingsSchema,
} from '../lib/validators.js'
import {
  getIntegrations,
  upsertIntegration,
  deleteIntegration,
  copyHotelSettings,
} from '../controllers/hotelSetupController.js'
import {
  getPriceRanks,
  createPriceRank,
  updatePriceRank,
  deletePriceRank,
  updateHotelSettings,
  getBudgets,
  putBudgets,
  getCompetitors,
  createCompetitor,
  updateCompetitor,
  deleteCompetitor,
  getRoomTypes,
  createRoomType,
  updateRoomType,
  deleteRoomType,
} from '../controllers/settingsController.js'

export const settingsRouter: ExpressRouter = Router()

// 全エンドポイント認証必須（C-2）
settingsRouter.use(authenticate)

// GET /api/v1/settings/price-ranks?hotelId=
settingsRouter.get(
  '/price-ranks',
  validate(hotelIdQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId),
  getPriceRanks
)

// 設定変更は MANAGER 以上（要件定義書 §4）
settingsRouter.post(
  '/price-ranks',
  requireRole('ADMIN', 'MANAGER'),
  validate(createPriceRankSchema),
  requireHotelAccess((req) => req.body?.hotelId),
  createPriceRank
)

settingsRouter.put(
  '/price-ranks/:id',
  requireRole('ADMIN', 'MANAGER'),
  validate(idParamSchema, 'params'),
  validate(hotelIdQuerySchema, 'query'),
  validate(updatePriceRankSchema),
  requireHotelAccess((req) => req.query.hotelId),
  updatePriceRank
)

settingsRouter.delete(
  '/price-ranks/:id',
  requireRole('ADMIN', 'MANAGER'),
  validate(idParamSchema, 'params'),
  validate(hotelIdQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId),
  deletePriceRank
)

// PUT /api/v1/settings/hotel/:id — ホテル設定（名称・週末定義等）変更は MANAGER 以上（F-SET-01）
settingsRouter.put(
  '/hotel/:id',
  requireRole('ADMIN', 'MANAGER'),
  validate(idParamSchema, 'params'),
  validate(updateHotelSettingsSchema),
  requireHotelAccess((req) => req.params.id),
  updateHotelSettings
)

// ======================================
// 月次予算（N-1 / F-SET-04）
// ======================================

// GET /api/v1/settings/budgets?hotelId=&year=
// 1〜12月ぶんを必ず返す（未登録の月は budget: null）
settingsRouter.get(
  '/budgets',
  validate(yearQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId),
  getBudgets
)

// PUT /api/v1/settings/budgets — 年単位の一括更新は MANAGER 以上
settingsRouter.put(
  '/budgets',
  requireRole('ADMIN', 'MANAGER'),
  validate(upsertBudgetsSchema),
  requireHotelAccess((req) => req.body?.hotelId),
  putBudgets
)

// ======================================
// 競合ホテル（N-2 / F-SET-03）
// ======================================

// GET /api/v1/settings/competitors?hotelId=
settingsRouter.get(
  '/competitors',
  validate(hotelIdQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId),
  getCompetitors
)

settingsRouter.post(
  '/competitors',
  requireRole('ADMIN', 'MANAGER'),
  validate(createCompetitorSchema),
  requireHotelAccess((req) => req.body?.hotelId),
  createCompetitor
)

settingsRouter.put(
  '/competitors/:id',
  requireRole('ADMIN', 'MANAGER'),
  validate(idParamSchema, 'params'),
  validate(hotelIdQuerySchema, 'query'),
  validate(updateCompetitorSchema),
  requireHotelAccess((req) => req.query.hotelId),
  updateCompetitor
)

settingsRouter.delete(
  '/competitors/:id',
  requireRole('ADMIN', 'MANAGER'),
  validate(idParamSchema, 'params'),
  validate(hotelIdQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId),
  deleteCompetitor
)

// ======================================
// 部屋タイプ（#81）
// ======================================

// GET /api/v1/settings/room-types?hotelId=
settingsRouter.get(
  '/room-types',
  validate(hotelIdQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId),
  getRoomTypes
)

settingsRouter.post(
  '/room-types',
  requireRole('ADMIN', 'MANAGER'),
  validate(createRoomTypeSchema),
  requireHotelAccess((req) => req.body?.hotelId),
  createRoomType
)

settingsRouter.put(
  '/room-types/:id',
  requireRole('ADMIN', 'MANAGER'),
  validate(idParamSchema, 'params'),
  validate(hotelIdQuerySchema, 'query'),
  validate(updateRoomTypeSchema),
  requireHotelAccess((req) => req.query.hotelId),
  updateRoomType
)

settingsRouter.delete(
  '/room-types/:id',
  requireRole('ADMIN', 'MANAGER'),
  validate(idParamSchema, 'params'),
  validate(hotelIdQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId),
  deleteRoomType
)

// 連携先（PMS・サイトコントローラー）の記録（#13）。閲覧は全ロール、変更は MANAGER 以上
// GET /api/v1/settings/integrations?hotelId=
settingsRouter.get(
  '/integrations',
  validate(hotelIdQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId),
  getIntegrations
)

// PUT /api/v1/settings/integrations
settingsRouter.put(
  '/integrations',
  requireRole('ADMIN', 'MANAGER'),
  validate(upsertIntegrationSchema),
  requireHotelAccess((req) => req.body?.hotelId),
  upsertIntegration
)

// DELETE /api/v1/settings/integrations/:kind?hotelId=
settingsRouter.delete(
  '/integrations/:kind',
  requireRole('ADMIN', 'MANAGER'),
  validate(integrationKindParamSchema, 'params'),
  validate(hotelIdQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId),
  deleteIntegration
)

// POST /api/v1/settings/copy-from — 既存ホテルから設定を複製（#13）。
// 複製元・複製先の両方にアクセスできる管理者（テナント全体を見る ADMIN か運営）だけが使える
settingsRouter.post(
  '/copy-from',
  requireRole('ADMIN'),
  validate(copyHotelSettingsSchema),
  requireHotelAccess((req) => req.body?.hotelId),
  requireHotelAccess((req) => req.body?.sourceHotelId),
  copyHotelSettings
)
