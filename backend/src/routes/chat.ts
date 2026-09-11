import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import { chatMessageSchema, hotelIdQuerySchema } from '../lib/validators.js'
import { sendMessage, listConversations, getConversation, listTools } from '../controllers/chatController.js'

// 会話フィードバック（docs/外部要因設計.md §7）。書き込み系ツールの権限はツール側（chatTools.ts）で二重に確認する
export const chatRouter: ExpressRouter = Router()

chatRouter.use(authenticate)

// POST /api/v1/chat/messages
chatRouter.post('/messages', requireHotelAccess((req) => req.body?.hotelId), validate(chatMessageSchema), sendMessage)

// GET /api/v1/chat/conversations?hotelId=
chatRouter.get(
  '/conversations',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(hotelIdQuerySchema, 'query'),
  listConversations
)

// GET /api/v1/chat/conversations/:id?hotelId=
chatRouter.get(
  '/conversations/:id',
  requireHotelAccess((req) => req.query.hotelId as string | undefined),
  validate(hotelIdQuerySchema, 'query'),
  getConversation
)

// GET /api/v1/chat/tools
chatRouter.get('/tools', listTools)
