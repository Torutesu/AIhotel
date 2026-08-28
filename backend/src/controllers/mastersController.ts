import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess, sendCreated, sendDeleted } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import {
  listMastersService,
  createMasterService,
  updateMasterService,
  deactivateMasterService,
  type MasterKind,
} from '../services/masterService.js'

// テナント別マスタ（SAAS_DECISIONS.md D-10）。
// 種別は URL の :kind（ota-channel / review-source）で切り替える。

function kindOf(req: Request): MasterKind {
  return req.params.kind as MasterKind
}

/** GET /api/v1/settings/masters/:kind?includeInactive= */
export const listMasters = asyncHandler(async (req: Request, res: Response) => {
  const includeInactive = req.query.includeInactive === 'true'
  sendSuccess(res, await listMastersService(kindOf(req), includeInactive))
})

/** POST /api/v1/settings/masters/:kind（MANAGER 以上・監査対象） */
export const createMaster = asyncHandler(async (req: Request, res: Response) => {
  const kind = kindOf(req)
  const row = await createMasterService(kind, req.body)
  await writeAuditLog({
    tenantId: req.user!.tenantId,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: kind,
    entityId: row.id,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendCreated(res, row)
})

/** PUT /api/v1/settings/masters/:kind/:id（MANAGER 以上・監査対象） */
export const updateMaster = asyncHandler(async (req: Request, res: Response) => {
  const kind = kindOf(req)
  const row = await updateMasterService(kind, req.params.id, req.body)
  await writeAuditLog({
    tenantId: req.user!.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: kind,
    entityId: req.params.id,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, row, 200, '更新しました')
})

/** DELETE /api/v1/settings/masters/:kind/:id（論理削除・MANAGER 以上・監査対象） */
export const deactivateMaster = asyncHandler(async (req: Request, res: Response) => {
  const kind = kindOf(req)
  await deactivateMasterService(kind, req.params.id)
  await writeAuditLog({
    tenantId: req.user!.tenantId,
    userId: req.user!.userId,
    action: 'DELETE',
    entity: kind,
    entityId: req.params.id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendDeleted(res, '無効化しました')
})
