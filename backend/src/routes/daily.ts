import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import { bookingCurveQuerySchema, competitorPricesQuerySchema } from '../lib/validators.js'
import { getBookingCurve, getCompetitorPrices } from '../controllers/dailyController.js'

export const dailyRouter: ExpressRouter = Router()

// 全エンドポイント認証必須 + hotelId のテナント分離（C-2/C-3）
dailyRouter.use(authenticate)
dailyRouter.use(requireHotelAccess((req) => req.query.hotelId as string | undefined))

// GET /api/v1/daily/booking-curve?hotelId=&date=
dailyRouter.get('/booking-curve', validate(bookingCurveQuerySchema, 'query'), getBookingCurve)

// GET /api/v1/daily/competitor-prices?hotelId=&startDate=&endDate=
dailyRouter.get(
  '/competitor-prices',
  validate(competitorPricesQuerySchema, 'query'),
  getCompetitorPrices
)
