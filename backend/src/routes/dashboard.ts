import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import {
  hotelIdQuerySchema,
  monthQuerySchema,
  kpiComparisonQuerySchema,
  aiSummaryQuerySchema,
} from '../lib/validators.js'
import {
  getKpi,
  getKpiComparison,
  getAlerts,
  getAiSummary,
} from '../controllers/dashboardController.js'

export const dashboardRouter: ExpressRouter = Router()

// 全エンドポイント認証必須 + hotelId のテナント分離（C-2/C-3）
dashboardRouter.use(authenticate)
dashboardRouter.use(requireHotelAccess((req) => req.query.hotelId as string | undefined))

// GET /api/v1/dashboard/kpi?hotelId=&year=&month=
dashboardRouter.get('/kpi', validate(monthQuerySchema, 'query'), getKpi)

// GET /api/v1/dashboard/kpi/comparison?hotelId=&year=&month=&baseDate=
dashboardRouter.get('/kpi/comparison', validate(kpiComparisonQuerySchema, 'query'), getKpiComparison)

// GET /api/v1/dashboard/alerts?hotelId=
dashboardRouter.get('/alerts', validate(hotelIdQuerySchema, 'query'), getAlerts)

// GET /api/v1/dashboard/ai-summary?hotelId=&section=
dashboardRouter.get('/ai-summary', validate(aiSummaryQuerySchema, 'query'), getAiSummary)
