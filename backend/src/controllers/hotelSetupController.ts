import type { Request, Response } from 'express'
import type { IntegrationKind } from '@prisma/client'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendDeleted, sendSuccess } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import {
  copyHotelSettingsService,
  deleteIntegrationService,
  listIntegrationsService,
  upsertIntegrationService,
} from '../services/hotelSetupService.js'
import { buildSetupWorkbookService, importSetupWorkbookService } from '../services/setupWorkbookService.js'
import type { CopyHotelSettingsInput, ImportSetupWorkbookInput, UpsertIntegrationInput } from '../lib/validators.js'

/** GET /api/v1/settings/integrations?hotelId= */
export const getIntegrations = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  sendSuccess(res, await listIntegrationsService(hotelId))
})

/** PUT /api/v1/settings/integrations — 種別（PMS / サイトコントローラー）ごとに1件 */
export const upsertIntegration = asyncHandler(async (req: Request, res: Response) => {
  const { before, after } = await upsertIntegrationService(req.body as UpsertIntegrationInput, req.user!.userId)
  await writeAuditLog({
    tenantId: after.tenantId,
    userId: req.user!.userId,
    action: before ? 'UPDATE' : 'CREATE',
    entity: 'HotelIntegration',
    entityId: after.id,
    oldValue: before,
    newValue: after,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, after, 200, '連携先を保存しました')
})

/** DELETE /api/v1/settings/integrations/:kind?hotelId= */
export const deleteIntegration = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  const deleted = await deleteIntegrationService(hotelId, req.params.kind as IntegrationKind)
  await writeAuditLog({
    tenantId: deleted.tenantId,
    userId: req.user!.userId,
    action: 'DELETE',
    entity: 'HotelIntegration',
    entityId: deleted.id,
    oldValue: deleted,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendDeleted(res)
})

/** POST /api/v1/settings/copy-from — 同じテナントの既存ホテルから設定を複製する */
export const copyHotelSettings = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, sourceHotelId, items } = req.body as CopyHotelSettingsInput
  const { tenantId, copied } = await copyHotelSettingsService(hotelId, sourceHotelId, items)
  await writeAuditLog({
    tenantId,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'HotelSettingsCopy',
    entityId: hotelId,
    newValue: { sourceHotelId, copied },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, { copied }, 200, '設定を複製しました')
})

/** GET /api/v1/hotels/:id/setup-workbook — 現在の設定を埋めた初期設定シート（Excel）を返す */
export const downloadSetupWorkbook = asyncHandler(async (req: Request, res: Response) => {
  const { buffer } = await buildSetupWorkbookService(req.params.id)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  // ホテル名は日本語を含むので RFC 5987 の filename* で渡す
  res.setHeader('Content-Disposition', `attachment; filename="setup.xlsx"; filename*=UTF-8''${encodeURIComponent('初期設定シート.xlsx')}`)
  res.send(buffer)
})

/** POST /api/v1/hotels/:id/setup-workbook — 初期設定シートの取り込み（dryRun 対応） */
export const importSetupWorkbook = asyncHandler(async (req: Request, res: Response) => {
  const { dryRun, fileBase64 } = req.body as ImportSetupWorkbookInput
  const { tenantId, ...result } = await importSetupWorkbookService({ hotelId: req.params.id, fileBase64, dryRun })
  if (!result.dryRun) {
    await writeAuditLog({
      tenantId,
      userId: req.user!.userId,
      action: 'UPDATE',
      entity: 'HotelSetupWorkbook',
      entityId: req.params.id,
      newValue: result,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }
  sendSuccess(res, result, 200, result.dryRun ? '初期設定シートを確認しました' : '初期設定シートを取り込みました')
})
