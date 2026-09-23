import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendCreated, sendSuccess } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import {
  createTenantService,
  listTenantsService,
  updateTenantService,
} from '../services/tenantsService.js'
import type { CreateTenantInput, UpdateTenantInput } from '../lib/validators.js'

/**
 * テナント一覧（運営専用 — #81）
 * GET /api/v1/platform/tenants
 */
export const getTenants = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await listTenantsService())
})

/**
 * テナント作成（運営専用・監査対象 — #81）
 * POST /api/v1/platform/tenants
 */
export const createTenant = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await createTenantService(req.body as CreateTenantInput)
  await writeAuditLog({
    tenantId: tenant.id,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'Tenant',
    entityId: tenant.id,
    newValue: tenant,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendCreated(res, tenant, 'テナントを作成しました')
})

/**
 * テナントの名称変更・契約停止／再開（運営専用・監査対象 — #81）
 * PUT /api/v1/platform/tenants/:id
 */
export const updateTenant = asyncHandler(async (req: Request, res: Response) => {
  const { before, after } = await updateTenantService(req.params.id, req.body as UpdateTenantInput)
  await writeAuditLog({
    tenantId: after.id,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'Tenant',
    entityId: after.id,
    oldValue: before,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, after, 200, 'テナントを更新しました')
})
