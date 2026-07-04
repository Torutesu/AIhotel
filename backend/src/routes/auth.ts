import { Router, type IRouter } from 'express'
import { validate } from '../middlewares/validate.js'
import { authenticate } from '../middlewares/auth.js'
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
router.post('/register', validate(registerSchema), register)
router.post('/refresh', validate(refreshTokenSchema), refresh)

// 認証が必要なエンドポイント
router.post('/logout', authenticate, logout)
router.post('/logout-all', authenticate, logoutAll)
router.get('/me', authenticate, getMe)

export const authRouter = router
