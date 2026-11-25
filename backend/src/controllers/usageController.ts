import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import { getUsageReportService } from '../services/usageService.js'
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
