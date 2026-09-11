import { Router, type Router as ExpressRouter, type Request, type Response, type NextFunction } from 'express'
import { authenticate, requireRole, requireHotelAccess } from '../middlewares/auth.js'
import { validate } from '../middlewares/validate.js'
import {
  alertsQuerySchema,
  monthQuerySchema,
  kpiComparisonQuerySchema,
  aiSummaryQuerySchema,
  updateAlertStatusSchema,
  monthTargetSchema,
  idParamSchema,
} from '../lib/validators.js'
import {
  getKpi,
  getKpiComparison,
  getAlerts,
  getAiSummary,
  patchAlertStatus,
  postKpiSnapshot,
} from '../controllers/dashboardController.js'

export const dashboardRouter: ExpressRouter = Router()

// 全エンドポイント認証必須 + hotelId のテナント分離（C-2/C-3）
dashboardRouter.use(authenticate)
// 参照系は hotelId をクエリで、操作系（PATCH/POST）はボディで受け取るため両方を見る
dashboardRouter.use(
  requireHotelAccess((req) => req.query.hotelId ?? req.body?.hotelId)
)

// GET /api/v1/dashboard/kpi?hotelId=&year=&month=
dashboardRouter.get('/kpi', validate(monthQuerySchema, 'query'), getKpi)

// GET /api/v1/dashboard/kpi/comparison?hotelId=&year=&month=&baseDate=
dashboardRouter.get('/kpi/comparison', validate(kpiComparisonQuerySchema, 'query'), getKpiComparison)

// GET /api/v1/dashboard/alerts?hotelId=&minLevel=
// minLevel を省略すると全レベルを返す。ダッシュボードは minLevel=4（Level 5・4のみ）
dashboardRouter.get('/alerts', validate(alertsQuerySchema, 'query'), getAlerts)

// GET /api/v1/dashboard/ai-summary?hotelId=&section=
dashboardRouter.get('/ai-summary', validate(aiSummaryQuerySchema, 'query'), getAiSummary)

/**
 * アラート操作のロール判定（N-4）。
 *
 * ACKNOWLEDGED（確認済み）は「現場が気づいた」という記録であり、
 * フロント担当＝OPERATOR が付けられないと運用にならないため OPERATOR にも許可する。
 * RESOLVED（解決済み）はアラートを一覧から外す判断なので、他の設定変更と同じく
 * MANAGER 以上に限定する。
 */
function requireAlertStatusRole(req: Request, res: Response, next: NextFunction) {
  if (req.body?.status === 'RESOLVED') {
    return requireRole('ADMIN', 'MANAGER')(req, res, next)
  }
  return next()
}

// PATCH /api/v1/dashboard/alerts/:id — 状態遷移（監査対象）
dashboardRouter.patch(
  '/alerts/:id',
  validate(idParamSchema, 'params'),
  validate(updateAlertStatusSchema),
  requireAlertStatusRole,
  patchAlertStatus
)

// POST /api/v1/dashboard/kpi/snapshot — 当日時点のKPIを保存（MANAGER 以上・監査対象 — N-5）
// 月初比較・日付比較（F-DASH-04）の比較元になる。同日・同対象月に対して冪等
dashboardRouter.post(
  '/kpi/snapshot',
  requireRole('ADMIN', 'MANAGER'),
  validate(monthTargetSchema),
  postKpiSnapshot
)
