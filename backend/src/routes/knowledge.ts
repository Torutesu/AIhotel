import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireRole } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import { knowledgeSearchSchema } from '../lib/validators.js'
import { search, status, reload } from '../controllers/knowledgeController.js'

// 知識ベース（docs/knowledge）。テナント共通の基礎資料なので hotelId は取らない。認証は必須
export const knowledgeRouter: ExpressRouter = Router()

knowledgeRouter.use(authenticate)

// GET /api/v1/knowledge/search?q=&k=
knowledgeRouter.get('/search', validate(knowledgeSearchSchema, 'query'), search)

// GET /api/v1/knowledge/status
knowledgeRouter.get('/status', status)

// POST /api/v1/knowledge/reload — ADMIN のみ
knowledgeRouter.post('/reload', requireRole('ADMIN'), reload)
