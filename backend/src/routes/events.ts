import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import {
  eventsQuerySchema,
  hotelIdQuerySchema,
  idParamSchema,
  createEventSchema,
  updateEventSchema,
} from '../lib/validators.js'
import { getEvents, createEvent, updateEvent, deleteEvent } from '../controllers/eventsController.js'

export const eventsRouter: ExpressRouter = Router()

// 全エンドポイント認証必須（C-2）
eventsRouter.use(authenticate)

// hotelId は requireHotelAccess の判定材料になるため、検証を先に通す
// GET /api/v1/events?hotelId=&startDate=&endDate=
eventsRouter.get(
  '/',
  validate(eventsQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  getEvents
)

// POST /api/v1/events — オペレーターも登録可能（要件定義書 F-DP-07）のため requireRole は付けない
eventsRouter.post(
  '/',
  validate(createEventSchema),
  requireHotelAccess((req) => req.body?.hotelId),
  createEvent
)

// PUT /api/v1/events/:id?hotelId=
eventsRouter.put(
  '/:id',
  validate(idParamSchema, 'params'),
  validate(hotelIdQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(updateEventSchema),
  updateEvent
)

// DELETE /api/v1/events/:id?hotelId=
eventsRouter.delete(
  '/:id',
  validate(idParamSchema, 'params'),
  validate(hotelIdQuerySchema, 'query'),
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  deleteEvent
)
