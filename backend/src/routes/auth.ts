import { Router, type IRouter } from 'express'
import rateLimit from 'express-rate-limit'
import { config } from '../lib/config.js'
import { validate } from '../middlewares/validate.js'
import { authenticate, requireRole } from '../middlewares/auth.js'
import {
  loginSchema,
  registerSchema,
  refreshTokenSchema,
  changePasswordSchema,
} from '../lib/validators.js'
import {
  login,
  register,
  refresh,
  logout,
  logoutAll,
  getMe,
  changePassword,
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

// トークン更新専用のレート制限（#78）。
// 正規のクライアントは15分のアクセストークン期限ごとに1回程度しか呼ばないため、
// 複数タブ・複数端末を見込んでも 60回/15分 あれば足りる
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.REFRESH_RATE_LIMIT_MAX,
  message: {
    success: false,
    error: 'トークン更新の回数が上限に達しました。しばらくしてから再度お試しください。',
  },
  standardHeaders: true,
  legacyHeaders: false,
})

// 公開エンドポイント（認証不要）
router.post('/login', loginLimiter, validate(loginSchema), login)
router.post('/refresh', refreshLimiter, validate(refreshTokenSchema), refresh)

// ユーザー登録は ADMIN と MANAGER のみ（運営 = PLATFORM_ADMIN も requireRole の上位集合として通る）。
// 公開登録は任意テナントへの自己所属を許すため廃止。
// ADMIN / MANAGER は自テナント内にしかユーザーを作れず、運営ロールは付与できない（N-3 / #62）。
// テナントの導出と権限チェックは registerService が行う
router.post('/register', authenticate, requireRole('ADMIN', 'MANAGER'), validate(registerSchema), register)

// 認証が必要なエンドポイント
router.post('/logout', authenticate, validate(refreshTokenSchema), logout)
router.post('/logout-all', authenticate, logoutAll)
router.get('/me', authenticate, getMe)
// 本人のパスワード変更（#89）。一時パスワードの変更待ちでも呼べる（authenticate が許可）
router.put('/password', authenticate, validate(changePasswordSchema), changePassword)

export const authRouter = router
