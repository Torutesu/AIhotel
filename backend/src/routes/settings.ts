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
} from '../lib/validators.js'
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
