import type { Request, Response } from 'express'
import { asyncHandler } from '../middlewares/errorHandler.js'
import { sendSuccess } from '../utils/response.js'
import {
  getBookingCurveService,
  getCompetitorPricesService,
} from '../services/dailyService.js'

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
