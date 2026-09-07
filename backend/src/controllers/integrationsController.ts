import type { Request, Response } from 'express'
import { asyncHandler, BadRequestError } from '../middlewares/errorHandler.js'
import { sendSuccess } from '../utils/response.js'
import { writeAuditLog } from '../services/auditService.js'
import { importOnTheBooksService, type OtbRow } from '../services/integrations/otbImportService.js'
import { importCompetitorPricesService, type CompetitorPriceRow } from '../services/integrations/competitorImportService.js'
import { parseCsv } from '../services/integrations/csv.js'

function parseDate(v: string, field: string, row: number): Date {
  const d = new Date(v.includes('T') ? v : `${v.replace(/\//g, '-')}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) throw new BadRequestError(`CSV ${row}行目: ${field} の日付が不正です（${v}）`)
  return d
}

function parseIntField(v: string | undefined): number | null {
  if (v == null || v === '') return null
  const n = Number(v.replace(/[,¥￥]/g, ''))
  if (!Number.isFinite(n)) return null
  return Math.round(n)
}

function parseBool(v: string | undefined): boolean {
  return ['1', 'true', 'yes', '満室', '売止', '売止め', 'x', '○'].includes((v ?? '').trim().toLowerCase())
}

/**
 * PMS からの OTB 取り込み（MANAGER 以上・監査対象）
 * POST /api/v1/integrations/otb
 */
export const importOnTheBooks = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, capturedAt, rows, csv } = req.body as { hotelId: string; capturedAt?: Date; rows?: OtbRow[]; csv?: string }
  const parsedRows: OtbRow[] = rows ?? []
  if (csv) {
    for (const [i, r] of parseCsv(csv).entries()) {
      const rooms = parseIntField(r.roomsBooked ?? r.rooms ?? r.otb)
      if (!r.stayDate || rooms == null) throw new BadRequestError(`CSV ${i + 2}行目: stayDate と roomsBooked が必要です`)
      const daysBefore = parseIntField(r.daysBefore)
      parsedRows.push({ stayDate: parseDate(r.stayDate, 'stayDate', i + 2), roomsBooked: rooms, ...(daysBefore != null ? { daysBefore } : {}) })
    }
  }
  const result = await importOnTheBooksService(hotelId, parsedRows, capturedAt)
  await writeAuditLog({
    tenantId: result.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'BookingCurveData',
    entityId: hotelId,
    newValue: { imported: result.imported, skipped: result.skipped.length, capturedAt: result.capturedAt },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, result, 200, `OTB を ${result.imported}件取り込みました`)
})

/**
 * 競合価格の取り込み（MANAGER 以上・監査対象）
 * POST /api/v1/integrations/competitor-prices
 */
export const importCompetitorPrices = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, rows, csv } = req.body as { hotelId: string; rows?: CompetitorPriceRow[]; csv?: string }
  const parsedRows: CompetitorPriceRow[] = rows ?? []
  if (csv) {
    for (const [i, r] of parseCsv(csv).entries()) {
      if (!r.date) throw new BadRequestError(`CSV ${i + 2}行目: date が必要です`)
      parsedRows.push({
        competitorId: r.competitorId || undefined,
        competitorName: r.competitorName || r.competitor || r.name || undefined,
        date: parseDate(r.date, 'date', i + 2),
        price1P: parseIntField(r.price1P),
        price2P: parseIntField(r.price2P),
        price3P: parseIntField(r.price3P),
        soldOut: parseBool(r.soldOut),
        dataSource: r.dataSource || 'import',
      })
    }
  }
  const result = await importCompetitorPricesService(hotelId, parsedRows)
  await writeAuditLog({
    tenantId: result.tenantId,
    userId: req.user!.userId,
    action: 'UPDATE',
    entity: 'CompetitorPriceData',
    entityId: hotelId,
    newValue: { imported: result.imported, createdCompetitors: result.createdCompetitors, skipped: result.skipped.length },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  })
  sendSuccess(res, result, 200, `競合価格を ${result.imported}件取り込みました`)
})
