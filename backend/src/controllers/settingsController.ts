import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess, sendCreated, sendDeleted } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import {
  getPriceRanksService,
  createPriceRankService,
  updatePriceRankService,
  deletePriceRankService,
  updateHotelSettingsService,
} from '../services/settingsService.js'
import { generatePriceRanksService } from '../services/provisioningService.js'
import {
  importRoomTypesService,
  importMonthlyBudgetsService,
  importDailyDataService,
} from '../services/importService.js'
import { getHotelOnboardingStatusService } from '../services/onboardingService.js'

/**
 * 料金ランク一覧
 * GET /api/v1/settings/price-ranks?hotelId=
 */
export const getPriceRanks = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  const result = await getPriceRanksService(hotelId)
  sendSuccess(res, result)
})

/**
 * 料金ランク作成（MANAGER 以上・監査対象）
 * POST /api/v1/settings/price-ranks
 */
export const createPriceRank = asyncHandler(async (req: Request, res: Response) => {
  const rank = await createPriceRankService(req.body)
  await writeAuditLog({
    tenantId: rank.tenantId,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'PriceRank',
    entityId: rank.id,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendCreated(res, rank)
})

/**
 * 料金ランク更新（MANAGER 以上・監査対象）
 * PUT /api/v1/settings/price-ranks/:id?hotelId=
 */
export const updatePriceRank = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  const rank = await updatePriceRankService(req.params.id, hotelId, req.body)
  await writeAuditLog({
    tenantId: rank?.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'PriceRank',
    entityId: req.params.id,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, rank, 200, '料金ランクを更新しました')
})

/**
 * 料金ランク削除（MANAGER 以上・監査対象）
 * DELETE /api/v1/settings/price-ranks/:id?hotelId=
 */
export const deletePriceRank = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  await deletePriceRankService(req.params.id, hotelId)
  await writeAuditLog({
    userId: req.user!.userId,
    action: 'DELETE',
    entity: 'PriceRank',
    entityId: req.params.id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendDeleted(res)
})

/**
 * 料金ランク一括自動生成（MANAGER 以上・監査対象 — F-SET-02 / SAAS_ONBOARDING.md Step 2）
 * POST /api/v1/settings/price-ranks/generate
 */
export const generatePriceRanks = asyncHandler(async (req: Request, res: Response) => {
  const ranks = await generatePriceRanksService(req.body)
  await writeAuditLog({
    tenantId: ranks[0]?.tenantId,
    userId: req.user!.userId,
    action: 'CREATE',
    entity: 'PriceRank',
    entityId: req.body.hotelId,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendCreated(res, ranks, `料金ランクを${ranks.length}段階生成しました`)
})

// CSVインポート3種（MANAGER 以上・監査対象 — SAAS_ONBOARDING.md Step 3）。
// CSVそのものは監査ログに残さず、対象ホテルと取込件数のみ記録する
function csvImportHandler(
  entity: string,
  service: (input: { hotelId: string; csv: string }) => Promise<{ imported: number }>
) {
  return asyncHandler(async (req: Request, res: Response) => {
    const { hotelId, csv } = req.body as { hotelId: string; csv: string }
    const result = await service({ hotelId, csv })
    await writeAuditLog({
      tenantId: req.user!.tenantId,
      userId: req.user!.userId,
      action: 'CREATE',
      entity,
      entityId: hotelId,
      newValue: { source: 'csv-import', imported: result.imported },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
    sendCreated(res, result, `${result.imported}件を取り込みました`)
  })
}

/** POST /api/v1/settings/import/room-types */
export const importRoomTypes = csvImportHandler('RoomType', importRoomTypesService)
/** POST /api/v1/settings/import/budgets */
export const importMonthlyBudgets = csvImportHandler('MonthlyBudget', importMonthlyBudgetsService)
/** POST /api/v1/settings/import/daily-data */
export const importDailyData = csvImportHandler('DailyData', importDailyDataService)

/**
 * オンボーディング完了状況（SAAS_ONBOARDING.md Step 5 — ウィザードUIが参照）
 * GET /api/v1/settings/onboarding-status?hotelId=
 */
export const getOnboardingStatus = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId } = req.query as unknown as { hotelId: string }
  const status = await getHotelOnboardingStatusService(hotelId)
  sendSuccess(res, status)
})

/**
 * ホテル設定更新（MANAGER 以上・監査対象 — F-SET-01）
 * PUT /api/v1/settings/hotel/:id
 */
export const updateHotelSettings = asyncHandler(async (req: Request, res: Response) => {
  const hotel = await updateHotelSettingsService(req.params.id, req.body)
  await writeAuditLog({
    tenantId: hotel.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'Hotel',
    entityId: hotel.id,
    newValue: req.body,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, hotel, 200, 'ホテル設定を更新しました')
})
