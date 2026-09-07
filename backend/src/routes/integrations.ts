import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireRole, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import { otbImportSchema, competitorPricesImportSchema } from '../lib/validators.js'
import { importOnTheBooks, importCompetitorPrices } from '../controllers/integrationsController.js'

// PMS/OTA 連携の器（docs/外部要因設計.md P2-11, §3 #5）。
// API 直結のコネクタが入るまでは JSON/CSV の手動取り込みで同じテーブルを埋める
export const integrationsRouter: ExpressRouter = Router()

integrationsRouter.use(authenticate)

// POST /api/v1/integrations/otb — PMS の OTB（予約積上）取り込み。MANAGER 以上
integrationsRouter.post(
  '/otb',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(otbImportSchema),
  importOnTheBooks
)

// POST /api/v1/integrations/competitor-prices — 競合価格・売止めの取り込み。MANAGER 以上
integrationsRouter.post(
  '/competitor-prices',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(competitorPricesImportSchema),
  importCompetitorPrices
)
