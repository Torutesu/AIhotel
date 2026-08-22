import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess, sendCreated } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import {
  issuePairingCode,
  listDevices,
  revokeDevice,
} from '../services/agentDeviceService.js'
import {
  createSyncJob,
  getSyncStatus,
  listSyncJobs,
  setWriteFrozenForHotel,
} from '../services/connectorJobService.js'

// コネクタ管理エンドポイント（ユーザーJWT認証 — 手動操作のみ。定常運用は無人 §2）

/**
 * ペアリングコード発行（生コードはこのレスポンスでのみ返る）
 * POST /api/v1/connector/hotels/:hotelId/pairing-codes
 */
export const createPairingCode = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.params
  const result = await issuePairingCode({
    hotelId,
    deviceName: req.body.deviceName,
    deviceRole: req.body.deviceRole,
    createdById: req.user!.userId,
  })
  await writeAuditLog({
    tenantId: req.user!.tenantId,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'AgentPairingCode',
    newValue: { hotelId, deviceName: req.body.deviceName },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendCreated(res, result, 'ペアリングコードを発行しました（有効期限10分・1回限り）')
})

/**
 * デバイス一覧
 * GET /api/v1/connector/hotels/:hotelId/devices
 */
export const getDevices = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await listDevices(req.params.hotelId))
})

/**
 * デバイス即時失効（kill switch — §12）
 * POST /api/v1/connector/hotels/:hotelId/devices/:deviceId/revoke
 */
export const revokeDeviceHandler = asyncHandler(async (req: Request, res: Response) => {
  const device = await revokeDevice(req.params.deviceId, req.params.hotelId)
  await writeAuditLog({
    tenantId: device?.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'AgentDevice',
    entityId: req.params.deviceId,
    newValue: { revoked: true },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, device, 200, 'デバイスを失効しました')
})

/**
 * 連携ステータス（鮮度・デバイス死活・直近ジョブ・未解決の開発側通知）
 * GET /api/v1/connector/hotels/:hotelId/status
 */
export const getStatus = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await getSyncStatus(req.params.hotelId))
})

/**
 * ジョブ一覧
 * GET /api/v1/connector/hotels/:hotelId/jobs
 */
export const getJobs = asyncHandler(async (req: Request, res: Response) => {
  const { status, limit } = req.query as unknown as { status?: string; limit?: number }
  sendSuccess(res, await listSyncJobs(req.params.hotelId, { status, limit }))
})

/**
 * 手動ジョブ作成（再実行・臨時READ用。定常のジョブは自動生成 — §2）
 * POST /api/v1/connector/hotels/:hotelId/jobs
 */
export const createJob = asyncHandler(async (req: Request, res: Response) => {
  const job = await createSyncJob({
    hotelId: req.params.hotelId,
    target: req.body.target,
    direction: req.body.direction,
    payload: req.body.payload,
    dryRun: req.body.dryRun,
    priority: req.body.priority,
    expiresAt: req.body.expiresAt,
    requestedById: req.user!.userId,
  })
  await writeAuditLog({
    tenantId: job.tenantId,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'SyncJob',
    entityId: job.id,
    newValue: { target: job.target, direction: job.direction, dryRun: job.dryRun },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendCreated(res, job)
})

/**
 * 凍結スイッチ（自動WRITE停止/再開。READは止めない — §13.6）
 * POST /api/v1/connector/hotels/:hotelId/freeze
 */
export const setFreeze = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.params
  const { frozen, reason } = req.body as { frozen: boolean; reason?: string }
  const { tenantId } = await setWriteFrozenForHotel(hotelId, frozen, reason ?? `手動${frozen ? '凍結' : '解除'}`)
  await writeAuditLog({
    tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'HotelSyncState',
    entityId: hotelId,
    newValue: { writeFrozen: frozen, reason },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, { writeFrozen: frozen }, 200, frozen ? '自動書き込みを凍結しました' : '凍結を解除しました')
})
