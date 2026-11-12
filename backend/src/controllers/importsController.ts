import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import { importDailyDataService } from '../services/importsService.js'
import { importCompetitorPricesService } from '../services/competitorPriceImportService.js'
import { importOtbService, importBookingCurveService } from '../services/otbImportService.js'
import type { ImportBookingCurveInput, ImportCompetitorPricesInput, ImportDailyDataInput, ImportOtbInput } from '../lib/validators.js'

/**
 * 日次実績の取り込み（MANAGER 以上・監査対象 — #82）
 * POST /api/v1/imports/daily-data
 */
export const importDailyData = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as ImportDailyDataInput
  const { tenantId, ...result } = await importDailyDataService(input)

  if (!result.dryRun) {
    // 行の中身は監査ログに残さない（件数と期間だけ。最大1,000行を毎回複製しないため）
    await writeAuditLog({
      tenantId,
      userId: req.user!.userId,
      action: 'UPDATE',
      entity: 'DailyData',
      entityId: input.hotelId,
      newValue: { import: 'daily-data', ...result },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  const message = result.dryRun
    ? `${result.total}行を確認しました（新規 ${result.created} / 更新 ${result.updated}）`
    : `${result.total}行を取り込みました（新規 ${result.created} / 更新 ${result.updated}）`
  sendSuccess(res, result, 200, message)
})

/**
 * 競合価格の取り込み（MANAGER 以上・監査対象 — #9）
 * POST /api/v1/imports/competitor-prices
 */
export const importCompetitorPrices = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as ImportCompetitorPricesInput
  const { tenantId, ...result } = await importCompetitorPricesService(input)

  if (!result.dryRun) {
    await writeAuditLog({
      tenantId,
      userId: req.user!.userId,
      action: 'UPDATE',
      entity: 'CompetitorPriceData',
      entityId: input.hotelId,
      newValue: { import: 'competitor-prices', ...result },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    })
  }

  const verb = result.dryRun ? '確認しました' : '取り込みました'
  sendSuccess(
    res,
    result,
    200,
    `${result.total}行を${verb}（競合×日付 ${result.aggregated}件: 新規 ${result.created} / 更新 ${result.updated}）`
  )
})

/**
 * OTB（予約積上室数）の取り込み（MANAGER 以上・監査対象 — #24 E2）
 * POST /api/v1/imports/otb
 */
export const importOtb = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as ImportOtbInput
  const { tenantId, ...result } = await importOtbService(input)
  await auditImport(req, tenantId, 'BookingCurveData', 'otb', result)

  const verb = result.dryRun ? '確認しました' : '取り込みました'
  sendSuccess(res, result, 200, `${result.capturedDate}時点の予約数 ${result.total}行を${verb}（新規 ${result.created} / 更新 ${result.updated}）`)
})

/** 取り込みの監査ログ（D-13 — 取り込みの共通部品）。試行（dryRun）は残さない */
async function auditImport(req: Request, tenantId: string, entity: string, kind: string, result: { dryRun: boolean }) {
  if (result.dryRun) return
  await writeAuditLog({
    tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity,
    entityId: (req.body as { hotelId: string }).hotelId,
    newValue: { import: kind, ...result },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
}

/**
 * 過去の予約積上（ブッキングカーブ）の一括取り込み（D-13 — 立ち上げ）
 * POST /api/v1/imports/booking-curve
 */
export const importBookingCurve = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId, ...result } = await importBookingCurveService(req.body as ImportBookingCurveInput)
  await auditImport(req, tenantId, 'BookingCurveData', 'booking-curve', result)
  const verb = result.dryRun ? '確認しました' : '取り込みました'
  sendSuccess(
    res,
    result,
    200,
    `過去の予約積上 ${result.total}行（宿泊日 ${result.startDate}〜${result.endDate}）を${verb}（新規 ${result.created} / 更新 ${result.updated}）`
  )
})
