import { Router, type Router as ExpressRouter } from 'express'
import { authenticate, requireRole, requireProviderAdmin } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import { provisionTenantSchema, idParamSchema, deleteTenantSchema } from '../lib/validators.js'
import {
  provisionTenant,
  listTenants,
  getTenantOnboardingStatus,
  exportTenantData,
  deactivateTenant,
  deleteTenant,
} from '../controllers/adminController.js'

export const adminRouter: ExpressRouter = Router()

// システム提供側（ADMIN）専用の管理API。全エンドポイント認証必須（C-2）。
// テナントを横断する操作のため、顧客側に配置された ADMIN は通さない
adminRouter.use(authenticate)
adminRouter.use(requireRole('ADMIN'))
adminRouter.use(requireProviderAdmin)

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

// 解約処理。データ書き出し → 無効化 → 削除 の順を想定している。
// 削除は無効化済みかつテナントコードの確認入力がある場合のみ実行できる
adminRouter.get('/tenants/:id/export', validate(idParamSchema, 'params'), exportTenantData)
adminRouter.post('/tenants/:id/deactivate', validate(idParamSchema, 'params'), deactivateTenant)
adminRouter.delete('/tenants/:id', validate(deleteTenantSchema), deleteTenant)
