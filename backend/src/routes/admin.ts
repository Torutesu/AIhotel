import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireRole } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import { provisionTenantSchema, idParamSchema } from '../lib/validators.js'
import {
  provisionTenant,
  listTenants,
  getTenantOnboardingStatus,
} from '../controllers/adminController.js'

export const adminRouter: ExpressRouter = Router()

// システム提供側（ADMIN）専用の管理API。全エンドポイント認証必須（C-2）
adminRouter.use(authenticate)
adminRouter.use(requireRole('ADMIN'))

// POST /api/v1/admin/tenants — テナント一括プロビジョニング（SAAS_ONBOARDING.md Step 1）
adminRouter.post('/tenants', validate(provisionTenantSchema), provisionTenant)

// GET /api/v1/admin/tenants — テナント一覧（導入担当ダッシュボード）
adminRouter.get('/tenants', listTenants)

// GET /api/v1/admin/tenants/:id/onboarding-status — テナント別の初期設定完了状況（Step 5）
adminRouter.get(
  '/tenants/:id/onboarding-status',
  validate(idParamSchema, 'params'),
  getTenantOnboardingStatus
)
