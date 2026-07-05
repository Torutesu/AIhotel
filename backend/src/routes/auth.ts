import { Router, type IRouter } from 'express'
import rateLimit from 'express-rate-limit'
import { config } from '../lib/config.js'
import { validate } from '../middlewares/validate.js'
import { authenticate, requireRole } from '../middlewares/auth.js'
import {
  loginSchema,
  registerSchema,
  refreshTokenSchema,
} from '../lib/validators.js'
import {
  login,
  register,
  refresh,
  logout,
  logoutAll,
  getMe,
} from '../controllers/authController.js'

const router: IRouter = Router()

// ログイン専用の厳格なレート制限（ブルートフォース対策 — W-4）
// 全体のレートリミッターより大幅に厳しい値にする
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.LOGIN_RATE_LIMIT_MAX,
  message: {
    success: false,
    error: 'ログイン試行回数の上限に達しました。しばらくしてから再度お試しください。',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
})

// 公開エンドポイント（認証不要）
router.post('/login', loginLimiter, validate(loginSchema), login)
router.post('/refresh', validate(refreshTokenSchema), refresh)

// ユーザー登録は ADMIN のみ（公開登録は任意テナントへの自己所属を許すため廃止）
router.post('/register', authenticate, requireRole('ADMIN'), validate(registerSchema), register)

// 認証が必要なエンドポイント
router.post('/logout', authenticate, validate(refreshTokenSchema), logout)
router.post('/logout-all', authenticate, logoutAll)
router.get('/me', authenticate, getMe)

export const authRouter = router
