import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { getMonthlyReportService } from '../services/reportsService.js'

/**
 * 月次レポート（Excel/PDF）ダウンロード（F-REP-01/02）
 * GET /api/v1/reports/monthly?hotelId=&year=&month=&format=pdf|excel
 *
 * 閲覧系のバイナリダウンロードのため、utils/response.ts の
 * 成功エンベロープ（{success:true,data}）は使わず、
 * Content-Type / Content-Disposition を直接設定して返す。監査ログ不要。
 */
export const getMonthlyReport = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, year, month, format } = req.query as unknown as {
    hotelId: string
    year: number
    month: number
    format: 'pdf' | 'excel'
  }

  const { buffer, contentType, filename } = await getMonthlyReportService(hotelId, year, month, format)

  res.setHeader('Content-Type', contentType)
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(buffer)
})
