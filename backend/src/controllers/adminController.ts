import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendCreated, sendSuccess } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import { provisionTenantService } from '../services/provisioningService.js'
import {
  listTenantsService,
  getTenantOnboardingStatusService,
} from '../services/onboardingService.js'
import {
  exportTenantDataService,
  deactivateTenantService,
  deleteTenantService,
} from '../services/tenantLifecycleService.js'
import type { ProvisionTenantInput } from '../lib/validators.js'

/**
 * テナント一括プロビジョニング（ADMIN専用・監査対象 — SAAS_ONBOARDING.md Step 1）
 * POST /api/v1/admin/tenants
 */
export const provisionTenant = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as ProvisionTenantInput
  const result = await provisionTenantService(input)

  // 監査ログにパスワード（平文）を残さない
  await writeAuditLog({
    tenantId: result.tenant.id,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'Tenant',
    entityId: result.tenant.id,
    newValue: {
      tenant: input.tenant,
      hotel: input.hotel,
      users: input.users.map(({ email, name, role }) => ({ email, name, role })),
      priceRanks: input.priceRanks ?? null,
    },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })

  sendCreated(res, result, 'テナントをプロビジョニングしました')
})

/**
 * テナント一覧（ADMIN専用 — 導入担当のダッシュボード用）
 * GET /api/v1/admin/tenants
 */
export const listTenants = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await listTenantsService())
})

/**
 * テナント別オンボーディング完了状況（ADMIN専用 — SAAS_ONBOARDING.md Step 5）
 * GET /api/v1/admin/tenants/:id/onboarding-status
 */
export const getTenantOnboardingStatus = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await getTenantOnboardingStatusService(req.params.id))
})

// ======================================
// 解約処理（ADMIN専用・すべて監査対象）
// ======================================

/**
 * テナントの全データを書き出す（返却用）。認証情報は含まない
 * GET /api/v1/admin/tenants/:id/export
 */
export const exportTenantData = asyncHandler(async (req: Request, res: Response) => {
  const data = await exportTenantDataService(req.params.id)
  await writeAuditLog({
    tenantId: req.params.id,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'Tenant',
    entityId: req.params.id,
    newValue: { exported: true },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, data)
})

/**
 * テナントを無効化する（解約の第一段階。データは残る）
 * POST /api/v1/admin/tenants/:id/deactivate
 */
export const deactivateTenant = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await deactivateTenantService(req.params.id)
  await writeAuditLog({
    tenantId: tenant.id,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'Tenant',
    entityId: tenant.id,
    newValue: { isActive: false },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, tenant, 200, 'テナントを無効化しました。ログインできなくなります')
})

/**
 * テナントを完全に削除する（取り消し不可）
 * DELETE /api/v1/admin/tenants/:id
 */
export const deleteTenant = asyncHandler(async (req: Request, res: Response) => {
  const { confirmationCode } = req.body as { confirmationCode: string }
  const result = await deleteTenantService(req.params.id, confirmationCode)
  // テナント行が消えるため、監査ログは tenantId を持たせずに残す
  await writeAuditLog({
    userId: req.user!.userId,
    action: 'DELETE',
    entity: 'Tenant',
    entityId: req.params.id,
    oldValue: { code: result.code, name: result.name },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, result, 200, 'テナントを削除しました')
})
