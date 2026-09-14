import type { Request, Response } from 'express'
import { asyncHandler, BadRequestError } from '../middlewares/errorHandler.js'
import { sendSuccess } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import {
  importReservationCsvService,
  listImportMappingsService,
  listImportRunsService,
  upsertImportMappingService,
} from '../services/importService.js'
import type {
  ImportMappingQueryInput,
  ImportReservationsQueryInput,
  ImportRunsQueryInput,
  UpsertImportMappingInput,
} from '../lib/validators.js'

/**
 * 列マッピングの取得（#6 / #18）
 * GET /api/v1/import/mapping?hotelId=&source=
 */
export const getImportMapping = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, source } = req.query as unknown as ImportMappingQueryInput
  sendSuccess(res, await listImportMappingsService(hotelId, source))
})

/**
 * 列マッピングの保存（#6 / #18）
 * PUT /api/v1/import/mapping
 *
 * 無人運用では端末はCSVを送るだけにしたいので、列の対応はここでサーバ側に置く。
 */
export const upsertImportMapping = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as UpsertImportMappingInput
  const saved = await upsertImportMappingService(input, req.user!.userId)

  await writeAuditLog({
    tenantId: req.user!.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'ImportMapping',
    entityId: `${input.hotelId}:${input.source}`,
    newValue: { encoding: saved.encoding, delimiter: saved.delimiter, mapping: saved.mapping },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })

  sendSuccess(res, saved, 200, '列マッピングを保存しました')
})

/**
 * 予約明細CSVの取込（#6 / #18）
 * POST /api/v1/import/reservations?hotelId=&source=&asOf=&dryRun=
 *
 * 本文はCSVそのもの（Content-Type: text/csv）。取込端末から定期送信されることを前提に、
 * パラメータはクエリで受け取り、列マッピングはサーバ側の保存済み設定を使う。
 */
export const importReservations = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ImportReservationsQueryInput

  // express.raw を通っていれば body は Buffer。JSON等で送られた場合はここで弾く
  if (!Buffer.isBuffer(req.body)) {
    throw new BadRequestError('CSVは Content-Type: text/csv で本文に入れて送ってください')
  }

  const result = await importReservationCsvService({
    query,
    csv: req.body,
    userId: req.user!.userId,
  })

  await writeAuditLog({
    tenantId: req.user!.tenantId,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'ImportRun',
    entityId: result.runId,
    newValue: {
      hotelId: query.hotelId,
      source: query.source,
      fileName: result.fileName,
      fileBytes: result.fileBytes,
      dryRun: result.dryRun,
      rowCount: result.rowCount,
      dailyRows: result.summary.dailyRows,
      curveRows: result.summary.curveRows,
    },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })

  sendSuccess(
    res,
    result,
    200,
    result.dryRun ? '取込内容を確認しました（dry-run のため保存していません）' : '取込が完了しました'
  )
})

/**
 * 取込履歴の一覧（#6）
 * GET /api/v1/import/runs?hotelId=&source=&limit=
 */
export const getImportRuns = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, source, limit } = req.query as unknown as ImportRunsQueryInput
  sendSuccess(res, await listImportRunsService(hotelId, source, limit))
})
