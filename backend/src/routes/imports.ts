import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireHotelAccess, requireRole } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import { importCompetitorPricesSchema, importDailyDataSchema, importOtbSchema } from '../lib/validators.js'
import { importCompetitorPrices, importDailyData, importOtb } from '../controllers/importsController.js'

// 実績データの取り込み（#82）。PMS 連携までのつなぎで、MANAGER 以上だけが実行できる
export const importsRouter: ExpressRouter = Router()

importsRouter.use(authenticate)

// POST /api/v1/imports/daily-data
importsRouter.post(
  '/daily-data',
  requireRole('ADMIN', 'MANAGER'),
  validate(importDailyDataSchema),
  requireHotelAccess((req) => req.body?.hotelId),
  importDailyData
)

// POST /api/v1/imports/competitor-prices — 競合価格（#9）
importsRouter.post(
  '/competitor-prices',
  requireRole('ADMIN', 'MANAGER'),
  validate(importCompetitorPricesSchema),
  requireHotelAccess((req) => req.body?.hotelId),
  importCompetitorPrices
)

// POST /api/v1/imports/otb — その時点の予約積上室数（#24 E2）。提供側が毎日自動で呼ぶ
importsRouter.post(
  '/otb',
  requireRole('ADMIN', 'MANAGER'),
  validate(importOtbSchema),
  requireHotelAccess((req) => req.body?.hotelId),
  importOtb
)
