import { Router, type IRouter } from 'express'
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

// 公開エンドポイント（認証不要）
router.post('/login', validate(loginSchema), login)
router.post('/refresh', validate(refreshTokenSchema), refresh)

// ユーザー登録は ADMIN のみ（公開登録は任意テナントへの自己所属を許すため廃止）
router.post('/register', authenticate, requireRole('ADMIN'), validate(registerSchema), register)

// 認証が必要なエンドポイント
router.post('/logout', authenticate, validate(refreshTokenSchema), logout)
router.post('/logout-all', authenticate, logoutAll)
router.get('/me', authenticate, getMe)

export const authRouter = router
