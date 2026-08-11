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
