import { Router, type Router as ExpressRouter } from 'express'
import rateLimit from 'express-rate-limit'
import { config } from '../lib/config.js'
import { authenticate, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import { chatSchema } from '../lib/validators.js'
import { postChat } from '../controllers/chatController.js'

// AI チャット（D-13）。読むだけなのでロールは問わない（ホテルへのアクセス権だけ確かめる）。
// Claude API の費用がかかるため、ユーザーごとに厳しめのレート制限をかける
export const chatRouter: ExpressRouter = Router()

const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.CHAT_RATE_LIMIT_MAX,
  keyGenerator: (req) => `chat:${req.user?.userId ?? req.ip ?? 'unknown'}`,
  message: { success: false, error: 'AI チャットの質問の回数が上限に達しました。しばらくしてから再度お試しください。' },
  standardHeaders: true,
  legacyHeaders: false,
})

chatRouter.use(authenticate)

// POST /api/v1/chat
chatRouter.post('/', chatLimiter, validate(chatSchema), requireHotelAccess((req) => req.body?.hotelId), postChat)
