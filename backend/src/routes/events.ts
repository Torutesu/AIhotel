import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import {
  eventsQuerySchema,
  hotelIdQuerySchema,
  createEventSchema,
  updateEventSchema,
} from '../lib/validators.js'
import { getEvents, createEvent, updateEvent, deleteEvent } from '../controllers/eventsController.js'

export const eventsRouter: ExpressRouter = Router()

// 全エンドポイント認証必須（C-2）
eventsRouter.use(authenticate)

// GET /api/v1/events?hotelId=&startDate=&endDate=
eventsRouter.get(
  '/',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(eventsQuerySchema, 'query'),
  getEvents
)

// POST /api/v1/events — オペレーターも登録可能（要件定義書 F-DP-07）のため requireRole は付けない
eventsRouter.post(
  '/',
  requireHotelAccess((req) => req.body?.hotelId),
  validate(createEventSchema),
  createEvent
)

// PUT /api/v1/events/:id?hotelId=
eventsRouter.put(
  '/:id',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(hotelIdQuerySchema, 'query'),
  validate(updateEventSchema),
  updateEvent
)

// DELETE /api/v1/events/:id?hotelId=
eventsRouter.delete(
  '/:id',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(hotelIdQuerySchema, 'query'),
  deleteEvent
)
