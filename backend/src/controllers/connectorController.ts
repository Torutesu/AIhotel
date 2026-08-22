import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess, sendCreated } from '../utils/response.js'
import type { SyncTarget } from '@hotel-revenue-system/shared/types'
import {
  pairDevice as pairDeviceService,
  touchDevice,
  rotateDeviceToken,
} from '../services/agentDeviceService.js'
import {
  claimNextJob,
  extendJobLease,
  reportJobResult,
  saveJobArtifact,
} from '../services/connectorJobService.js'
import { getConnectorDefinition } from '../lib/connectorDefinitions.js'

// コネクタエージェント向けエンドポイント（デバイストークン認証 — docs/コネクタ連携設計.md §5）。
// /devices/pair のみワンタイムコード認証（/auth/login と同様の公開例外扱い・レート制限付き）

/**
 * ペアリングコードをデバイストークンに交換
 * POST /api/v1/connector/devices/pair
 */
export const pairDevice = asyncHandler(async (req: Request, res: Response) => {
  const { code, agentVersion } = req.body as { code: string; agentVersion?: string }
  const result = await pairDeviceService(code, agentVersion)
  sendCreated(res, result, 'デバイスを登録しました')
})

/**
 * 死活監視（デッドマン検知 §14.1 の基準となる lastSeenAt 更新）
 * POST /api/v1/connector/heartbeat
 */
export const heartbeat = asyncHandler(async (req: Request, res: Response) => {
  const { agentVersion } = req.body as { agentVersion?: string }
  await touchDevice(req.agentDevice!, agentVersion)
  sendSuccess(res, { serverTime: new Date().toISOString() })
})

/**
 * 次のジョブをクレーム（リース付き）
 * GET /api/v1/connector/jobs/next
 */
export const claimJob = asyncHandler(async (req: Request, res: Response) => {
  const job = await claimNextJob(req.agentDevice!)
  sendSuccess(res, { job })
})

/**
 * リース延長
 * POST /api/v1/connector/jobs/:id/lease
 */
export const extendLease = asyncHandler(async (req: Request, res: Response) => {
  const leaseExpiresAt = await extendJobLease(req.params.id, req.agentDevice!)
  sendSuccess(res, { leaseExpiresAt: leaseExpiresAt.toISOString() })
})

/**
 * 実行結果報告（READ結果の取込・失敗時のリトライ/凍結/通知はサービス側で判断）
 * POST /api/v1/connector/jobs/:id/result
 */
export const reportResult = asyncHandler(async (req: Request, res: Response) => {
  const outcome = await reportJobResult(req.params.id, req.agentDevice!, req.body)
  sendSuccess(res, outcome)
})

/**
 * 証跡スナップショット添付（サニタイズ済みのみ受理 — §12）
 * POST /api/v1/connector/jobs/:id/artifacts
 */
export const uploadArtifact = asyncHandler(async (req: Request, res: Response) => {
  const snapshot = await saveJobArtifact(req.params.id, req.agentDevice!, req.body)
  sendCreated(res, snapshot)
})

/**
 * セレクタ・操作手順定義の配信（バージョン付き）
 * GET /api/v1/connector/definitions?target=LINCOLN
 */
export const getDefinitions = asyncHandler(async (req: Request, res: Response) => {
  const { target } = req.query as unknown as { target: SyncTarget }
  sendSuccess(res, { definition: getConnectorDefinition(target) })
})

/**
 * デバイストークンのローテーション（現行トークンで認証済みの状態で実行 — §12）
 * POST /api/v1/connector/devices/rotate-token
 */
export const rotateToken = asyncHandler(async (req: Request, res: Response) => {
  const result = await rotateDeviceToken(req.agentDevice!.id)
  sendSuccess(res, result, 200, 'デバイストークンをローテーションしました')
})
