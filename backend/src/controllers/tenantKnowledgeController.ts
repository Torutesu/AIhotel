import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess, sendCreated, sendDeleted } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import {
  saveKnowledgeDocumentService,
  listKnowledgeDocumentsService,
  getKnowledgeDocumentService,
  deleteKnowledgeDocumentService,
  applyHotelRulesService,
} from '../services/knowledge/tenantKnowledgeService.js'
import { parseHotelRules } from '../services/knowledge/hotelRules.js'
import type { HotelRules } from '../services/knowledge/hotelRules.js'

/** GET /api/v1/knowledge/documents?hotelId= — 個社MD一覧（テナント共通＋そのホテル専用） */
export const listDocuments = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  sendSuccess(res, await listKnowledgeDocumentsService(req.user!.tenantId!, hotelId))
})

/** GET /api/v1/knowledge/documents/:id?hotelId= */
export const getDocument = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await getKnowledgeDocumentService(req.params.id, req.user!.tenantId!))
})

/** POST /api/v1/knowledge/documents/preview — 保存せずにルール節を解釈して確認する */
export const previewDocument = asyncHandler(async (req: Request, res: Response) => {
  const { body } = req.body as { body: string }
  sendSuccess(res, parseHotelRules(body))
})

/** POST /api/v1/knowledge/documents — 作成（MANAGER 以上・監査対象）。ルール節は解釈して反映 */
export const createDocument = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, title, body, tenantWide } = req.body as { hotelId: string; title: string; body: string; tenantWide?: boolean }
  const result = await saveKnowledgeDocumentService({ tenantId: req.user!.tenantId!, hotelId: tenantWide ? null : hotelId, title, body, userId: req.user!.userId })
  await writeAuditLog({
    tenantId: req.user!.tenantId,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'KnowledgeDocument',
    entityId: result.document.id,
    newValue: { title, hotelId: result.document.hotelId, version: result.document.version, applied: result.applied },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendCreated(res, result, describeSave(result.rulesFound, result.document.rulesErrors.length, result.applied?.recomputedDays))
})

/** PUT /api/v1/knowledge/documents/:id — 更新（版を進め、旧版を保存。MANAGER 以上・監査対象） */
export const updateDocument = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, title, body, tenantWide } = req.body as { hotelId: string; title: string; body: string; tenantWide?: boolean }
  const result = await saveKnowledgeDocumentService({ tenantId: req.user!.tenantId!, hotelId: tenantWide ? null : hotelId, title, body, userId: req.user!.userId }, req.params.id)
  await writeAuditLog({
    tenantId: req.user!.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'KnowledgeDocument',
    entityId: result.document.id,
    newValue: { title, hotelId: result.document.hotelId, version: result.document.version, applied: result.applied },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, result, 200, describeSave(result.rulesFound, result.document.rulesErrors.length, result.applied?.recomputedDays))
})

/** POST /api/v1/knowledge/documents/:id/apply — 解釈済みルールを再反映（MANAGER 以上） */
export const applyDocument = asyncHandler(async (req: Request, res: Response) => {
  const doc = await getKnowledgeDocumentService(req.params.id, req.user!.tenantId!)
  const rules = doc.rules as unknown as HotelRules | null
  if (!rules) {
    sendSuccess(res, { applied: null }, 200, 'この文書には反映できるルールがありません（ルール節が無いか、エラーがあります）')
    return
  }
  const applied = await applyHotelRulesService(doc.tenantId, doc.hotelId, rules)
  await writeAuditLog({
    tenantId: req.user!.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'KnowledgeDocument',
    entityId: doc.id,
    newValue: { reapplied: applied },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, { applied }, 200, `ルールを反映しました（${applied.hotelIds.length}ホテル、${applied.recomputedDays}日を再計算）`)
})

/** DELETE /api/v1/knowledge/documents/:id?hotelId= — MANAGER 以上・監査対象 */
export const deleteDocument = asyncHandler(async (req: Request, res: Response) => {
  await deleteKnowledgeDocumentService(req.params.id, req.user!.tenantId!)
  await writeAuditLog({
    tenantId: req.user!.tenantId,
    userId: req.user!.userId,
    action: 'DELETE',
    entity: 'KnowledgeDocument',
    entityId: req.params.id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendDeleted(res, '個社MDを削除しました')
})

function describeSave(rulesFound: boolean, errorCount: number, recomputedDays?: number): string {
  if (!rulesFound) return '個社MDを保存しました（ルール節なし。引用のみに使われます）'
  if (errorCount > 0) return `個社MDを保存しました。ルール節に解釈できない行が ${errorCount} 件あるため、ルールは反映していません`
  return `個社MDを保存し、ルールを反映しました（${recomputedDays ?? 0}日を再計算）`
}
