import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess } from '../utils/response.js'
import { listAuditLogsService } from '../services/auditService.js'
import type { AuditLogQuery } from '../lib/validators.js'

/**
 * 監査ログの閲覧（ADMIN 以上 — #89）
 * GET /api/v1/audit-logs?hotelId=&from=&to=&action=&cursor=&limit=
 */
export const getAuditLogs = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await listAuditLogsService(req.query as unknown as AuditLogQuery))
})
