import type { Request, Response } from 'express'
import { asyncHandler, BadRequestError } from '../middlewares/errorHandler.js'
import { sendSuccess } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import {
  disableIpRestrictionByPlatformService,
  getIpRestrictionService,
  updateIpRestrictionService,
} from '../services/ipRestrictionService.js'
import type { UpdateIpRestrictionInput } from '../lib/validators.js'

// IP 制限（#12）。テナントの管理者が自テナントの設定を読み書きする。運営はテナントを持たないので、解除だけを /platform から行う

function ownTenantId(req: Request): string {
  const tenantId = req.user!.tenantId
  if (!tenantId) throw new BadRequestError('運営アカウントはテナントを持たないため、テナント管理から操作してください')
  return tenantId
}

/** GET /api/v1/settings/ip-restriction（ADMIN） */
export const getIpRestriction = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await getIpRestrictionService(ownTenantId(req), req.ip))
})

/** PUT /api/v1/settings/ip-restriction（ADMIN・監査対象） */
export const updateIpRestriction = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = ownTenantId(req)
  const { before, after } = await updateIpRestrictionService(tenantId, req.body as UpdateIpRestrictionInput, req.ip)
  await writeAuditLog({
    tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'IpRestriction',
    entityId: tenantId,
    oldValue: { enabled: before.enabled, entries: before.entries },
    newValue: { enabled: after.enabled, entries: after.entries },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, after, 200, after.enabled ? 'IP 制限を保存しました' : 'IP 制限を無効にしました')
})

/** POST /api/v1/platform/tenants/:id/disable-ip-restriction（運営・監査対象）。締め出されたテナントの復旧用 */
export const disableIpRestrictionByPlatform = asyncHandler(async (req: Request, res: Response) => {
  const { wasEnabled } = await disableIpRestrictionByPlatformService(req.params.id)
  await writeAuditLog({
    tenantId: req.params.id,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'IpRestriction',
    entityId: req.params.id,
    oldValue: { enabled: wasEnabled },
    newValue: { enabled: false, by: 'PLATFORM_ADMIN' },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, null, 200, 'IP 制限を解除しました')
})
