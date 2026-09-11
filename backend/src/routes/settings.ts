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
} from '../lib/validators.js'
import {
  getPriceRanks,
  createPriceRank,
  updatePriceRank,
  deletePriceRank,
  updateHotelSettings,
  getBudgets,
  putBudgets,
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
  validate(idParamSchema, 'params'),
  validate(hotelIdQuerySchema, 'query'),
  validate(updatePriceRankSchema),
  updatePriceRank
)

settingsRouter.delete(
  '/price-ranks/:id',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(idParamSchema, 'params'),
  validate(hotelIdQuerySchema, 'query'),
  deletePriceRank
)

// PUT /api/v1/settings/hotel/:id — ホテル設定（名称・週末定義等）変更は MANAGER 以上（F-SET-01）
settingsRouter.put(
  '/hotel/:id',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.params.id),
  validate(idParamSchema, 'params'),
  validate(updateHotelSettingsSchema),
  updateHotelSettings
)

// ======================================
// 月次予算（N-1 / F-SET-04）
// ======================================

// GET /api/v1/settings/budgets?hotelId=&year=
// 1〜12月ぶんを必ず返す（未登録の月は budget: null）
settingsRouter.get(
  '/budgets',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(yearQuerySchema, 'query'),
  getBudgets
)

// PUT /api/v1/settings/budgets — 年単位の一括更新は MANAGER 以上
settingsRouter.put(
  '/budgets',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(upsertBudgetsSchema),
  putBudgets
)
