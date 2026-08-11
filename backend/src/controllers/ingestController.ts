import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess, sendCreated } from '../utils/response.js'
import {
  ingestNightsService,
  ingestReservationsService,
  ingestInventoryService,
  getIngestLogsService,
} from '../services/ingestService.js'
import { ingestFileService, listIngestProfiles } from '../services/fileIngestService.js'
import {
  getIngestStatusService,
  upsertIngestSchedulesService,
} from '../services/ingestMonitorService.js'
import { runIngestConnectorsService } from '../services/ingestRunnerService.js'
import { writeAuditLog } from '../services/auditService.js'

/**
 * 宿泊実績1泊明細の取込（前日実績・過去データ移行）
 * POST /api/v1/ingest/pms/nights
 */
export const ingestNights = asyncHandler(async (req: Request, res: Response) => {
  const result = await ingestNightsService(req.body, req.user!.userId)
  sendCreated(res, result, '実績明細を取り込みました')
})

/**
 * オンハンド予約明細の取込（180日分の断面）
 * POST /api/v1/ingest/pms/reservations
 */
export const ingestReservations = asyncHandler(async (req: Request, res: Response) => {
  const result = await ingestReservationsService(req.body, req.user!.userId)
  sendCreated(res, result, 'オンハンド予約を取り込みました')
})

/**
 * 残室スナップショットの取込（日別×タイプ別）
 * POST /api/v1/ingest/pms/inventory
 */
export const ingestInventory = asyncHandler(async (req: Request, res: Response) => {
  const result = await ingestInventoryService(req.body, req.user!.userId)
  sendCreated(res, result, '残室スナップショットを取り込みました')
})

/**
 * 取込ログ一覧
 * GET /api/v1/ingest/logs?hotelId=&limit=
 */
export const getIngestLogs = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, limit } = req.query as unknown as { hotelId: string; limit: number }
  const result = await getIngestLogsService(hotelId, limit)
  sendSuccess(res, result)
})

/**
 * ファイル取込（CSV/Excel）— 取得手段を問わない共通の入口
 * POST /api/v1/ingest/file
 */
export const ingestFile = asyncHandler(async (req: Request, res: Response) => {
  const result = await ingestFileService(req.body, req.user!.userId)
  const message = req.body.dryRun
    ? `検証しました（取込可能 ${result.acceptedRows} / 全 ${result.totalRows} 行）`
    : `ファイルを取り込みました（${result.acceptedRows} 行）`
  sendSuccess(res, result, 200, message)
})

/**
 * 取込プロファイル一覧（管理画面の選択肢用）
 * GET /api/v1/ingest/profiles
 */
export const getIngestProfiles = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, listIngestProfiles())
})

/**
 * 取込状況（未着検知）— 自動連携の監視用
 * GET /api/v1/ingest/status?hotelId=
 */
export const getIngestStatus = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  const result = await getIngestStatusService(hotelId)
  sendSuccess(res, result)
})

/**
 * 取込スケジュール設定（MANAGER 以上・監査対象）
 * PUT /api/v1/ingest/schedules
 */
export const upsertIngestSchedules = asyncHandler(async (req: Request, res: Response) => {
  const result = await upsertIngestSchedulesService(req.body)
  await writeAuditLog({
    tenantId: result.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'IngestSchedule',
    entityId: req.body.hotelId,
    newValue: { itemCount: result.upserted },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, result, 200, '取込スケジュールを更新しました')
})

/**
 * 自動取得を今すぐ実行する（スケジューラを待たずに試す / 外部スケジューラからの呼び出し口）
 * POST /api/v1/ingest/run
 */
export const runIngestConnectors = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, source } = req.body as { hotelId: string; source?: string }
  const result = await runIngestConnectorsService({ hotelId, source })
  sendSuccess(res, result, 200, '自動取込を実行しました')
})
