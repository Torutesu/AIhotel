import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireHotelAccess, requireRole } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import {
  createNewHotelSchema,
  hotelIdQuerySchema,
  idParamSchema,
  importNewHotelsSchema,
  updateNewHotelSchema,
} from '../lib/validators.js'
import {
  createNewHotel,
  deleteNewHotel,
  importNewHotels,
  listNewHotels,
  updateNewHotel,
} from '../controllers/newHotelsController.js'

// 周辺の新規ホテル（外部需要動向 — 2026-10）。参照は全ロール、変更は MANAGER 以上
export const newHotelsRouter: ExpressRouter = Router()

newHotelsRouter.use(authenticate)

// GET /api/v1/new-hotels?hotelId=
newHotelsRouter.get('/', validate(hotelIdQuerySchema, 'query'), requireHotelAccess((req) => req.query.hotelId), listNewHotels)

// POST /api/v1/new-hotels
newHotelsRouter.post(
  '/',
  requireRole('ADMIN', 'MANAGER'),
  validate(createNewHotelSchema),
  requireHotelAccess((req) => req.body?.hotelId),
  createNewHotel
)

// POST /api/v1/new-hotels/import
newHotelsRouter.post(
  '/import',
  requireRole('ADMIN', 'MANAGER'),
  validate(importNewHotelsSchema),
  requireHotelAccess((req) => req.body?.hotelId),
  importNewHotels
)

// PUT /api/v1/new-hotels/:id?hotelId=
newHotelsRouter.put(
  '/:id',
  requireRole('ADMIN', 'MANAGER'),
  validate(idParamSchema, 'params'),
  validate(hotelIdQuerySchema, 'query'),
  validate(updateNewHotelSchema),
  requireHotelAccess((req) => req.query.hotelId),
  updateNewHotel
)

// DELETE /api/v1/new-hotels/:id?hotelId=
newHotelsRouter.delete(
  '/:id',
  requireRole('ADMIN', 'MANAGER'),
  validate(idParamSchema, 'params'),
  validate(hotelIdQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId),
  deleteNewHotel
)
