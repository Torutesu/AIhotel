import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireRole, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import {
  createImportSchema,
  importTemplateQuerySchema,
  importJobsQuerySchema,
} from '../lib/validators.js'
import { createImport, getImportTemplate, getImportJobs } from '../controllers/importsController.js'

export const importsRouter: ExpressRouter = Router()

// 全エンドポイント認証必須（C-2）
importsRouter.use(authenticate)

// GET /api/v1/imports?hotelId=&limit= — 取込履歴
importsRouter.get(
  '/',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(importJobsQuerySchema, 'query'),
  getImportJobs
)

// GET /api/v1/imports/template?hotelId=&type= — テンプレートダウンロード
importsRouter.get(
  '/template',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(importTemplateQuerySchema, 'query'),
  getImportTemplate
)

// POST /api/v1/imports — Excel取込（データ変更系のため MANAGER 以上）
importsRouter.post(
  '/',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(createImportSchema),
  createImport
)
