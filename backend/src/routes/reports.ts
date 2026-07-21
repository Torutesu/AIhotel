import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import { monthlyReportQuerySchema } from '../lib/validators.js'
import { getMonthlyReport } from '../controllers/reportsController.js'

export const reportsRouter: ExpressRouter = Router()

// 全エンドポイント認証必須（C-2）
reportsRouter.use(authenticate)

// GET /api/v1/reports/monthly?hotelId=&year=&month=&format=pdf|excel
reportsRouter.get(
  '/monthly',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(monthlyReportQuerySchema, 'query'),
  getMonthlyReport
)
