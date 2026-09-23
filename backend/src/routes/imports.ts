import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireHotelAccess, requireRole } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import { importDailyDataSchema } from '../lib/validators.js'
import { importDailyData } from '../controllers/importsController.js'

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
