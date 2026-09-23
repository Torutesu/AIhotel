import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireRole } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import { createTenantSchema, idParamSchema, updateTenantSchema } from '../lib/validators.js'
import { createTenant, getTenants, updateTenant } from '../controllers/platformController.js'

// 運営（PLATFORM_ADMIN）専用のエンドポイント（#81）。
// requireRole('PLATFORM_ADMIN') は運営以外（ADMIN を含む）をすべて 403 にする。
// テナントの作成・契約停止はテナントを越える操作なので、テナント側のロールには決して開放しない（#62）
export const platformRouter: ExpressRouter = Router()

platformRouter.use(authenticate, requireRole('PLATFORM_ADMIN'))

// GET /api/v1/platform/tenants
platformRouter.get('/tenants', getTenants)

// POST /api/v1/platform/tenants
platformRouter.post('/tenants', validate(createTenantSchema), createTenant)

// PUT /api/v1/platform/tenants/:id
platformRouter.put(
  '/tenants/:id',
  validate(idParamSchema, 'params'),
  validate(updateTenantSchema),
  updateTenant
)
