import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import { knowledgeStatus, reloadKnowledge, searchKnowledge } from '../services/knowledge/knowledgeService.js'

/** GET /api/v1/knowledge/search?q=&k= — 知識ベースの章検索（引用の確認用） */
export const search = asyncHandler(async (req: Request, res: Response) => {
  const { q, k } = req.query as unknown as { q: string; k?: number }
  const hits = searchKnowledge(q, k)
  sendSuccess(
    res,
    hits.map((h) => ({ id: h.chunk.id, path: h.chunk.path, docTitle: h.chunk.docTitle, heading: h.chunk.heading, text: h.chunk.text, score: h.score }))
  )
})

/** GET /api/v1/knowledge/status — 読み込み済みドキュメント一覧 */
export const status = asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, knowledgeStatus())
})

/** POST /api/v1/knowledge/reload — 再読込（ADMIN） */
export const reload = asyncHandler(async (req: Request, res: Response) => {
  const result = reloadKnowledge()
  await writeAuditLog({
    tenantId: req.user!.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'KnowledgeBase',
    newValue: result,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, result, 200, `知識ベースを再読込しました（${result.documents}文書・${result.chunks}章）`)
})
