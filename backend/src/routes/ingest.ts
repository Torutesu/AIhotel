import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireRole, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import {
  ingestNightsSchema,
  ingestReservationsSchema,
  ingestInventorySchema,
  ingestLogsQuerySchema,
  fileIngestSchema,
} from '../lib/validators.js'
import {
  ingestNights,
  ingestReservations,
  ingestInventory,
  getIngestLogs,
  ingestFile,
  getIngestProfiles,
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

// POST /api/v1/ingest/file — CSV/Excelの取込（プロファイル駆動・冪等）
// 取得手段（RPA/ネイティブ自動化/SC連携/手動アップロード）を問わない共通の入口
ingestRouter.post(
  '/file',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(fileIngestSchema),
  ingestFile
)

// GET /api/v1/ingest/profiles — 取込プロファイル一覧（ホテル非依存のため認証のみ）
ingestRouter.get('/profiles', getIngestProfiles)

// GET /api/v1/ingest/logs?hotelId=&limit= — 取込ログ（オペレーターも閲覧可）
ingestRouter.get(
  '/logs',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(ingestLogsQuerySchema, 'query'),
  getIngestLogs
)
