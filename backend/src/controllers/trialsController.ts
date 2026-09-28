import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendCreated, sendSuccess } from '../utils/response.js'
import { writeAuditLog, type AuditAction } from '../services/auditService.js'
import {
  createTrialService,
  deleteTrialService,
  listTrialsService,
  resetTrialPasswordService,
  updateTrialService,
} from '../services/trialsService.js'
import type { CreateTrialInputBody, UpdateTrialInputBody } from '../lib/validators.js'

// トライアル（デモ）アカウントの管理（運営専用）。
// 監査ログは tenantId を持たせずに残す（トライアルのテナントを削除しても運営の操作記録が消えないようにする）。
// パスワードは発行・再発行のレスポンスで1回だけ返し、監査ログには残さない。

function audit(req: Request, action: AuditAction, entityId: string, oldValue?: unknown, newValue?: unknown) {
  return writeAuditLog({
    tenantId: null,
    userId: req.user!.userId,
    action,
    entity: 'Trial',
    entityId,
    oldValue,
    newValue,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
}

/** GET /api/v1/platform/trials */
export const getTrials = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await listTrialsService())
})

/** POST /api/v1/platform/trials */
export const createTrial = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as CreateTrialInputBody
  const { trial, password } = await createTrialService(input)
  await audit(req, 'CREATE', trial.id, undefined, {
    name: trial.name,
    kind: trial.kind,
    expiresAt: trial.expiresAt,
    loginEmail: trial.loginEmail,
  })
  sendCreated(res, { trial, password }, 'トライアルを発行しました')
})

/** PUT /api/v1/platform/trials/:id（名前・メモ・停止/再開・期限の延長） */
export const updateTrial = asyncHandler(async (req: Request, res: Response) => {
  const { before, after } = await updateTrialService(req.params.id, req.body as UpdateTrialInputBody)
  await audit(
    req,
    'UPDATE',
    after.id,
    { name: before.name, status: before.status, expiresAt: before.expiresAt },
    { name: after.name, status: after.status, expiresAt: after.expiresAt }
  )
  sendSuccess(res, after, 200, 'トライアルを更新しました')
})

/** POST /api/v1/platform/trials/:id/reset-password */
export const resetTrialPassword = asyncHandler(async (req: Request, res: Response) => {
  const { trial, password } = await resetTrialPasswordService(req.params.id)
  await audit(req, 'PASSWORD_RESET', trial.id, undefined, { loginEmail: trial.loginEmail })
  sendSuccess(res, { trial, password }, 200, 'パスワードを再発行しました')
})

/** DELETE /api/v1/platform/trials/:id（テナントとデモデータをすべて削除） */
export const deleteTrial = asyncHandler(async (req: Request, res: Response) => {
  const trial = await deleteTrialService(req.params.id)
  await audit(req, 'DELETE', trial.id, { name: trial.name, loginEmail: trial.loginEmail })
  sendSuccess(res, null, 200, 'トライアルを削除しました')
})
