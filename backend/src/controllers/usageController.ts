import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import { ApiError } from '../middlewares/errorHandler.js'
import type { OperationsUsageScope } from '../lib/validators.js'
import { getProductionUsageTenantsService, getUsageReportService } from '../services/usageService.js'
import type { UsageEventInput } from '../lib/validators.js'
export const recordUsage = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as UsageEventInput
  // Only the authenticated customer's own activity. Operator visits are not customer adoption.
  if (req.user!.role !== 'PLATFORM_ADMIN') await writeAuditLog({ tenantId: req.user!.tenantId, userId: req.user!.userId, action: 'USAGE', entity: `Usage:${input.event}`, entityId: input.hotelId })
  sendSuccess(res, null)
})
export const getUsage = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await getUsageReportService())
})

export const getOperationsUsage = asyncHandler(async (req: Request, res: Response) => {
  const scope = req.body as OperationsUsageScope
  sendSuccess(res, await getUsageReportService(scope.role === 'AGENCY' ? scope.tenantIds! : undefined))
})
export const getProductionUsageTenants = asyncHandler(async (req: Request, res: Response) => {
  const scope = req.body as OperationsUsageScope
  if (scope.role !== 'PLATFORM_ADMIN') throw new ApiError(403, '全体管理者のみ操作できます')
  sendSuccess(res, await getProductionUsageTenantsService())
})
