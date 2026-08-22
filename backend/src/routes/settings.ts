import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireRole, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import {
  hotelIdQuerySchema,
  createPriceRankSchema,
  updatePriceRankSchema,
  generatePriceRanksSchema,
  updateHotelSettingsSchema,
  csvImportSchema,
} from '../lib/validators.js'
import {
  getPriceRanks,
  createPriceRank,
  updatePriceRank,
  deletePriceRank,
  generatePriceRanks,
  updateHotelSettings,
  importRoomTypes,
  importMonthlyBudgets,
  importDailyData,
  getOnboardingStatus,
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

// POST /api/v1/settings/price-ranks/generate — 下限〜上限価格から最大40段階を一括生成（Step 2）
settingsRouter.post(
  '/price-ranks/generate',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(generatePriceRanksSchema),
  generatePriceRanks
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

// GET /api/v1/settings/onboarding-status?hotelId= — 初期設定の完了状況（Step 5）
settingsRouter.get(
  '/onboarding-status',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(hotelIdQuerySchema, 'query'),
  getOnboardingStatus
)

// CSVインポート3種（Step 3）。変更系のため MANAGER 以上
settingsRouter.post(
  '/import/room-types',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(csvImportSchema),
  importRoomTypes
)
settingsRouter.post(
  '/import/budgets',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(csvImportSchema),
  importMonthlyBudgets
)
settingsRouter.post(
  '/import/daily-data',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(csvImportSchema),
  importDailyData
)

// PUT /api/v1/settings/hotel/:id — ホテル設定（名称・週末定義等）変更は MANAGER 以上（F-SET-01）
settingsRouter.put(
  '/hotel/:id',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.params.id),
  validate(updateHotelSettingsSchema),
  updateHotelSettings
)
