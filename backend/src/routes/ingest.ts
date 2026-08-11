import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireRole, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import {
  ingestNightsSchema,
  ingestReservationsSchema,
  ingestInventorySchema,
  ingestLogsQuerySchema,
} from '../lib/validators.js'
import {
  ingestNights,
  ingestReservations,
  ingestInventory,
  getIngestLogs,
} from '../controllers/ingestController.js'

// PMSデータ取込（Phase 4A — F-OH-01/02, F-INV-01, F-ING-01）
// 呼び出し元はPMSデータ自動取得アプリ（クローラ）のマシンアカウント、または手動移行時のADMIN/MANAGER
export const ingestRouter: ExpressRouter = Router()

// 全エンドポイント認証必須
ingestRouter.use(authenticate)

// POST /api/v1/ingest/pms/nights — 宿泊実績1泊明細（計上日単位で全量置換・冪等）
ingestRouter.post(
  '/pms/nights',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(ingestNightsSchema),
  ingestNights
)

// POST /api/v1/ingest/pms/reservations — オンハンド予約（capturedDate単位で全量置換・冪等）
ingestRouter.post(
  '/pms/reservations',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(ingestReservationsSchema),
  ingestReservations
)

// POST /api/v1/ingest/pms/inventory — 残室スナップショット（capturedDate単位で全量置換・冪等）
ingestRouter.post(
  '/pms/inventory',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(ingestInventorySchema),
  ingestInventory
)

// GET /api/v1/ingest/logs?hotelId=&limit= — 取込ログ（オペレーターも閲覧可）
ingestRouter.get(
  '/logs',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(ingestLogsQuerySchema, 'query'),
  getIngestLogs
)
