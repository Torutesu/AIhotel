import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireRole, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import { knowledgeSearchSchema, knowledgeDocumentSchema, knowledgePreviewSchema, hotelIdQuerySchema } from '../lib/validators.js'
import { search, status, reload } from '../controllers/knowledgeController.js'
import {
  listDocuments,
  getDocument,
  previewDocument,
  createDocument,
  updateDocument,
  applyDocument,
  deleteDocument,
} from '../controllers/tenantKnowledgeController.js'

// 知識ベース（docs/knowledge）。テナント共通の基礎資料なので hotelId は取らない。認証は必須
export const knowledgeRouter: ExpressRouter = Router()

knowledgeRouter.use(authenticate)

// GET /api/v1/knowledge/search?q=&k=
knowledgeRouter.get('/search', validate(knowledgeSearchSchema, 'query'), search)

// GET /api/v1/knowledge/status
knowledgeRouter.get('/status', status)

// POST /api/v1/knowledge/reload — ADMIN のみ
knowledgeRouter.post('/reload', requireRole('ADMIN'), reload)

// ---- 個社MD（テナント/ホテル単位）。参照は全員、変更は MANAGER 以上
const byQueryHotel = requireHotelAccess((req) => req.query.hotelId as string | undefined)
const byBodyHotel = requireHotelAccess((req) => req.body?.hotelId)

// GET /api/v1/knowledge/documents?hotelId=
knowledgeRouter.get('/documents', byQueryHotel, validate(hotelIdQuerySchema, 'query'), listDocuments)

// POST /api/v1/knowledge/documents/preview — ルール節の解釈結果を確認（保存しない）
knowledgeRouter.post('/documents/preview', byBodyHotel, validate(knowledgePreviewSchema), previewDocument)

// POST /api/v1/knowledge/documents
knowledgeRouter.post('/documents', requireRole('ADMIN', 'MANAGER'), byBodyHotel, validate(knowledgeDocumentSchema), createDocument)

// GET /api/v1/knowledge/documents/:id?hotelId=
knowledgeRouter.get('/documents/:id', byQueryHotel, validate(hotelIdQuerySchema, 'query'), getDocument)

// PUT /api/v1/knowledge/documents/:id
knowledgeRouter.put('/documents/:id', requireRole('ADMIN', 'MANAGER'), byBodyHotel, validate(knowledgeDocumentSchema), updateDocument)

// POST /api/v1/knowledge/documents/:id/apply?hotelId= — ルールの再反映
knowledgeRouter.post('/documents/:id/apply', requireRole('ADMIN', 'MANAGER'), byQueryHotel, validate(hotelIdQuerySchema, 'query'), applyDocument)

// DELETE /api/v1/knowledge/documents/:id?hotelId=
knowledgeRouter.delete('/documents/:id', requireRole('ADMIN', 'MANAGER'), byQueryHotel, validate(hotelIdQuerySchema, 'query'), deleteDocument)
