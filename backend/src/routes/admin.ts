import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireRole } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import { provisionTenantSchema } from '../lib/validators.js'
import { provisionTenant } from '../controllers/adminController.js'

export const adminRouter: ExpressRouter = Router()

// システム提供側（ADMIN）専用の管理API。全エンドポイント認証必須（C-2）
adminRouter.use(authenticate)
adminRouter.use(requireRole('ADMIN'))

// POST /api/v1/admin/tenants — テナント一括プロビジョニング（SAAS_ONBOARDING.md Step 1）
adminRouter.post('/tenants', validate(provisionTenantSchema), provisionTenant)
