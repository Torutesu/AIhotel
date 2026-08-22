import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendCreated } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import { provisionTenantService } from '../services/provisioningService.js'
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
