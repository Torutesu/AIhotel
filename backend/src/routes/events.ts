import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireHotelAccess, requireRole } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import {
  eventsQuerySchema,
  hotelIdQuerySchema,
  createEventSchema,
  updateEventSchema,
  createVenueSchema,
  updateVenueSchema,
  reviewEventCandidateSchema,
  detectCandidatesSchema,
  extractVenueSchema,
} from '../lib/validators.js'
import {
  getEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  getVenues,
  createVenue,
  updateVenue,
  deleteVenue,
  extractVenueEvents,
  getEventCandidates,
  detectEventCandidates,
  reviewEventCandidate,
} from '../controllers/eventsController.js'

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


// ======================================
// 会場マスタ（docs/外部要因設計.md §3 #3）— '/:id' より前に定義する
// ======================================

// GET /api/v1/events/venues?hotelId=
eventsRouter.get(
  '/venues',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(hotelIdQuerySchema, 'query'),
  getVenues
)

// POST /api/v1/events/venues — MANAGER 以上
eventsRouter.post(
  '/venues',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(createVenueSchema),
  createVenue
)

// PUT /api/v1/events/venues/:id?hotelId= — MANAGER 以上
eventsRouter.put(
  '/venues/:id',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(hotelIdQuerySchema, 'query'),
  validate(updateVenueSchema),
  updateVenue
)

// DELETE /api/v1/events/venues/:id?hotelId= — MANAGER 以上
eventsRouter.delete(
  '/venues/:id',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(hotelIdQuerySchema, 'query'),
  deleteVenue
)

// POST /api/v1/events/venues/:id/extract — 会場ページから Claude で候補抽出（MANAGER 以上）
eventsRouter.post(
  '/venues/:id/extract',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(extractVenueSchema),
  extractVenueEvents
)

// ======================================
// イベント候補（自動検出・承認）
// ======================================

// GET /api/v1/events/candidates?hotelId=
eventsRouter.get(
  '/candidates',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(hotelIdQuerySchema, 'query'),
  getEventCandidates
)

// POST /api/v1/events/candidates/detect — 前年の稼働残差から候補検出（MANAGER 以上）
eventsRouter.post(
  '/candidates/detect',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(detectCandidatesSchema),
  detectEventCandidates
)

// POST /api/v1/events/candidates/:id/review — 承認/却下（MANAGER 以上）
eventsRouter.post(
  '/candidates/:id/review',
  requireRole('ADMIN', 'MANAGER'),
  requireHotelAccess((req) => req.body?.hotelId),
  validate(reviewEventCandidateSchema),
  reviewEventCandidate
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
