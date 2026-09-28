import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireRole } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import {
  createTenantSchema,
  createTrialSchema,
  idParamSchema,
  updateTenantSchema,
  updateTrialSchema,
} from '../lib/validators.js'
import { createTenant, getTenants, updateTenant } from '../controllers/platformController.js'
import { disableIpRestrictionByPlatform } from '../controllers/ipRestrictionController.js'
import {
  createTrial,
  deleteTrial,
  getTrials,
  resetTrialPassword,
  updateTrial,
} from '../controllers/trialsController.js'

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

// POST /api/v1/platform/tenants/:id/disable-ip-restriction — IP 制限で締め出されたテナントの復旧（#12）
platformRouter.post(
  '/tenants/:id/disable-ip-restriction',
  validate(idParamSchema, 'params'),
  disableIpRestrictionByPlatform
)

// ======================================
// トライアル（デモ）アカウント — 販売店・営業先ホテルに期限つきで渡す
// ======================================

// GET /api/v1/platform/trials
platformRouter.get('/trials', getTrials)

// POST /api/v1/platform/trials
platformRouter.post('/trials', validate(createTrialSchema), createTrial)

// PUT /api/v1/platform/trials/:id
platformRouter.put('/trials/:id', validate(idParamSchema, 'params'), validate(updateTrialSchema), updateTrial)

// POST /api/v1/platform/trials/:id/reset-password
platformRouter.post('/trials/:id/reset-password', validate(idParamSchema, 'params'), resetTrialPassword)

// DELETE /api/v1/platform/trials/:id
platformRouter.delete('/trials/:id', validate(idParamSchema, 'params'), deleteTrial)
