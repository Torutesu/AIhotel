import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import {
  getDashboardKpiService,
  getKpiComparisonService,
  getAlertsService,
  getAiSummaryService,
  updateAlertStatusService,
} from '../services/dashboardService.js'
import type { UpdateAlertStatusInput } from '../lib/validators.js'

/**
 * 月別KPI取得
 * GET /api/v1/dashboard/kpi?hotelId=&year=&month=
 */
export const getKpi = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, year, month } = req.query as unknown as {
    hotelId: string
    year: number
    month: number
  }
  const result = await getDashboardKpiService(hotelId, year, month)
  sendSuccess(res, result)
})

/**
 * KPI比較（月初/日付比較）
 * GET /api/v1/dashboard/kpi/comparison?hotelId=&year=&month=&baseDate=
 */
export const getKpiComparison = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, year, month, baseDate } = req.query as unknown as {
    hotelId: string
    year: number
    month: number
    baseDate?: Date
  }
  const result = await getKpiComparisonService(hotelId, year, month, baseDate)
  sendSuccess(res, result)
})

/**
 * アラート一覧
 * GET /api/v1/dashboard/alerts?hotelId=
 */
export const getAlerts = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, minLevel } = req.query as unknown as { hotelId: string; minLevel?: number }
  const result = await getAlertsService(hotelId, minLevel)
  sendSuccess(res, result)
})

/**
 * AIまとめ
 * GET /api/v1/dashboard/ai-summary?hotelId=&section=
 */
export const getAiSummary = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, section } = req.query as unknown as { hotelId: string; section?: string }
  const result = await getAiSummaryService(hotelId, section)
  sendSuccess(res, result)
})

/**
 * アラートの状態遷移（N-4・監査対象）
 * PATCH /api/v1/dashboard/alerts/:id
 * body: { hotelId, status: 'ACKNOWLEDGED' | 'RESOLVED' }
 */
export const patchAlertStatus = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, status } = req.body as UpdateAlertStatusInput
  const { before, after } = await updateAlertStatusService(req.params.id, hotelId, status)

  await writeAuditLog({
    tenantId: before.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'Alert',
    entityId: before.id,
    oldValue: { status: before.status, resolvedAt: before.resolvedAt },
    newValue: { status: after.status, resolvedAt: after.resolvedAt },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })

  sendSuccess(res, after, 200, 'アラートの状態を更新しました')
})
