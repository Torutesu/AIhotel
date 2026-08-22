import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import {
  createImportService,
  generateImportTemplateService,
  getImportJobsService,
} from '../services/importService.js'
import type { ImportType } from '../lib/validators.js'

/**
 * Excel取込実行（MANAGER 以上・監査対象）
 * POST /api/v1/imports
 *
 * 行エラーがある場合も HTTP 200 で status='failed' と行別エラーを返す
 * （リクエスト自体は正常に処理されており、UIが行単位のエラーを表示するため）。
 */
export const createImport = asyncHandler(async (req: Request, res: Response) => {
  const result = await createImportService(req.body, req.user!.userId)
  await writeAuditLog({
    tenantId: req.user!.tenantId ?? undefined,
    userId: req.user!.userId,
    action: 'IMPORT',
    entity: 'ImportJob',
    entityId: result.jobId,
    newValue: {
      hotelId: req.body.hotelId,
      type: result.type,
      fileName: result.fileName,
      status: result.status,
      rowCount: result.rowCount,
      createdCount: result.createdCount,
      updatedCount: result.updatedCount,
      errorCount: result.errorCount,
    },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  const message =
    result.status === 'completed'
      ? `${result.createdCount + result.updatedCount}件を反映しました（新規${result.createdCount}・更新${result.updatedCount}）`
      : `取込エラーが${result.errorCount}件あります。修正して再アップロードしてください`
  sendSuccess(res, result, 200, message)
})

/**
 * 取込用Excelテンプレートのダウンロード
 * GET /api/v1/imports/template?hotelId=&type=price_ranks|daily_actual
 *
 * バイナリダウンロードのため成功エンベロープは使わない（reportsController と同方式）
 */
export const getImportTemplate = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, type } = req.query as unknown as { hotelId: string; type: ImportType }
  const { buffer, contentType, filename } = await generateImportTemplateService(hotelId, type)

  res.setHeader('Content-Type', contentType)
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(buffer)
})

/**
 * 取込履歴一覧
 * GET /api/v1/imports?hotelId=&limit=
 */
export const getImportJobs = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, limit } = req.query as unknown as { hotelId: string; limit: number }
  const result = await getImportJobsService(hotelId, limit)
  sendSuccess(res, result)
})
