import express, { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireRole, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import {
  importMappingQuerySchema,
  importReservationsQuerySchema,
  importRunsQuerySchema,
  upsertImportMappingSchema,
} from '../lib/validators.js'
import {
  getImportMapping,
  getImportRuns,
  importReservations,
  upsertImportMapping,
} from '../controllers/importController.js'

export const importRouter: ExpressRouter = Router()

// 全エンドポイント認証必須（C-2）
importRouter.use(authenticate)

// GET /api/v1/import/mapping?hotelId=&source=
importRouter.get(
  '/mapping',
  validate(importMappingQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId),
  getImportMapping
)

// 取込設定の変更は MANAGER 以上
importRouter.put(
  '/mapping',
  requireRole('ADMIN', 'MANAGER'),
  validate(upsertImportMappingSchema),
  requireHotelAccess((req) => req.body?.hotelId),
  upsertImportMapping
)

// POST /api/v1/import/reservations?hotelId=...
//
// 本文はCSVそのもの。アプリ全体の JSON 上限は 1mb なので、CSV だけこのルートで
// raw パーサを通して 20mb まで許可する（3年分の予約明細を一括で送る場合を見込む）。
// 実績の書き込みを伴うため MANAGER 以上。取込端末には専用アカウントを払い出す運用とする。
importRouter.post(
  '/reservations',
  requireRole('ADMIN', 'MANAGER'),
  express.raw({ type: ['text/csv', 'text/plain', 'application/octet-stream'], limit: '20mb' }),
  validate(importReservationsQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId),
  importReservations
)

// GET /api/v1/import/runs?hotelId=&source=&limit=
importRouter.get(
  '/runs',
  validate(importRunsQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId),
  getImportRuns
)
