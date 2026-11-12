import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendCreated, sendSuccess } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import {
  createTenantService,
  listTenantsService,
  updateTenantService,
} from '../services/tenantsService.js'
import type { CreateTenantInput, ProvisionTenantInput, UpdateTenantInput } from '../lib/validators.js'
import { provisionTenantService } from '../services/provisioningService.js'
import { sendTemporaryPasswordMail } from '../services/accountMailService.js'

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

/**
 * 新しいテナントの立ち上げ（運営専用・監査対象 — D-13 / R-3-8）。テナント・最初のホテル・テナント管理者を1回で作る
 * POST /api/v1/platform/tenants/provision
 */
export const provisionTenant = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as ProvisionTenantInput
  const { tenant, hotel, admin, temporaryPassword } = await provisionTenantService(input)
  const emailSent = await sendTemporaryPasswordMail({ kind: 'invite', to: admin.email, name: admin.name, temporaryPassword })
  await writeAuditLog({
    tenantId: tenant.id,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'TenantProvision',
    entityId: tenant.id,
    // 一時パスワードは残さない
    newValue: { tenant, hotel, admin: { email: admin.email, name: admin.name }, emailSent },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendCreated(
    res,
    { tenant, hotel, admin, emailSent, temporaryPassword: emailSent ? null : temporaryPassword },
    emailSent ? 'テナントを立ち上げ、管理者に一時パスワードをメールで送りました' : 'テナントを立ち上げました（一時パスワードは今回だけ表示します）'
  )
})
