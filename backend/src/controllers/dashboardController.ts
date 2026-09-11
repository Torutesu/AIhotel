import type { Request, Response } from 'express'
import { generateAiSummaryService } from '../services/chat/aiSummaryService.js'
import { writeAuditLog } from '../services/auditService.js'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess } from '../utils/response.js'
import {
  getDashboardKpiService,
  getKpiComparisonService,
  getAlertsService,
  getAiSummaryService,
} from '../services/dashboardService.js'

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
 * AIまとめの生成（LLM。MANAGER 以上・監査対象）
 * POST /api/v1/dashboard/ai-summary/generate
 */
export const generateAiSummary = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, section, llmProvider, llmModel } = req.body as { hotelId: string; section?: string; llmProvider?: 'anthropic' | 'openai'; llmModel?: string }
  const result = await generateAiSummaryService(hotelId, section, { provider: llmProvider, model: llmModel })
  await writeAuditLog({
    tenantId: result.comment.tenantId,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'AiComment',
    entityId: result.comment.id,
    newValue: { section: result.comment.section, llm: result.llm },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, result.comment, 201, `AIまとめを生成しました（${result.llm.provider} / ${result.llm.model}）`)
})
