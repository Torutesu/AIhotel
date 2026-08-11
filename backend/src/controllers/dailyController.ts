import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess } from '../utils/response.js'
import {
  getBookingCurveService,
  getCompetitorPricesService,
} from '../services/dailyService.js'
import { getOnHandCurveService, getInventoryViewService } from '../services/onHandService.js'
import type { OnHandCurveQueryInput, InventoryQueryInput } from '../lib/validators.js'

/**
 * ブッキングカーブ
 * GET /api/v1/daily/booking-curve?hotelId=&date=
 */
export const getBookingCurve = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, date } = req.query as unknown as { hotelId: string; date: Date }
  const result = await getBookingCurveService(hotelId, date)
  sendSuccess(res, result)
})

/**
 * 競合価格比較（利用人数別・ホテル別）
 * GET /api/v1/daily/competitor-prices?hotelId=&startDate=&endDate=
 */
export const getCompetitorPrices = asyncHandler(async (req: Request, res: Response) => {
  const { hotelId, startDate, endDate } = req.query as unknown as {
    hotelId: string
    startDate: Date
    endDate: Date
  }
  const result = await getCompetitorPricesService(hotelId, startDate, endDate)
  sendSuccess(res, result)
})

/**
 * オンハンド ブッキングカーブ（リードタイム別・前年対比 — F-OH-03）
 * GET /api/v1/daily/onhand-curve?hotelId=&stayDate= | &year=&month=
 */
export const getOnHandCurve = asyncHandler(async (req: Request, res: Response) => {
  const result = await getOnHandCurveService(req.query as unknown as OnHandCurveQueryInput)
  sendSuccess(res, result)
})

/**
 * 残室ビュー（日別×タイプ別・前回断面との差異 — F-INV-01）
 * GET /api/v1/daily/inventory?hotelId=&startDate=&endDate=&capturedDate=
 */
export const getInventoryView = asyncHandler(async (req: Request, res: Response) => {
  const result = await getInventoryViewService(req.query as unknown as InventoryQueryInput)
  sendSuccess(res, result)
})
