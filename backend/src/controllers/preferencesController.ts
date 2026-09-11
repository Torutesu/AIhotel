import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import {
  getPreferencesService,
  updatePreferencesService,
} from '../services/preferencesService.js'
import type { UpdatePreferencesInput } from '../lib/validators.js'

/**
 * 自分の画面表示設定を取得（#51-2）
 * GET /api/v1/preferences?hotelId=
 */
export const getPreferences = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  const preferences = await getPreferencesService(req.user!.userId, hotelId)
  sendSuccess(res, preferences)
})

/**
 * 自分の画面表示設定を保存（#51-2）
 * PUT /api/v1/preferences
 *
 * 対象は常に「リクエストした本人の設定」。userId はトークンから取り、body では受け取らない。
 */
export const updatePreferences = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as UpdatePreferencesInput
  const preferences = await updatePreferencesService(req.user!.userId, input)

  await writeAuditLog({
    tenantId: req.user!.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'UserPreference',
    entityId: `${req.user!.userId}:${input.hotelId}`,
    newValue: preferences.dashboard,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })

  sendSuccess(res, preferences, 200, '表示設定を保存しました')
})
