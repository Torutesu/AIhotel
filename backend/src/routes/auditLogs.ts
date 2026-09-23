import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireHotelAccess, requireRole } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import { auditLogQuerySchema } from '../lib/validators.js'
import { getAuditLogs } from '../controllers/auditLogsController.js'

// 監査ログの閲覧（#89）。テナントの管理者（ADMIN）と運営だけが見られる。
// 自テナント外のホテルを指定すると requireHotelAccess が 403 にする
export const auditLogsRouter: ExpressRouter = Router()

auditLogsRouter.get(
  '/',
  authenticate,
  requireRole('ADMIN'),
  validate(auditLogQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId),
  getAuditLogs
)
