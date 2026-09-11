import { z } from 'zod'
import { dateOnly, todayJst } from './date.js'

// ======================================
// Common Validators
// ======================================

// エンティティID。cuid形式に固定しない（seedの固定ID 'demo-hotel-001' や、
// 将来DB/BaaS変更でID形式が変わる場合に備え、不透明な文字列として扱う）
export const entityIdSchema = z
  .string()
  .min(1, 'IDは必須です')
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'IDの形式が不正です')

// パスパラメータ :id の検証（C-11）。/:id を持つ全ルートに
// validate(idParamSchema, 'params') を適用している
export const idParamSchema = z.object({
  id: entityIdSchema,
})

// ======================================
// Auth Validators
// ======================================

export const loginSchema = z.object({
  // メールアドレスは大文字小文字を区別しない（#44）。検索も登録も小文字で行う
  email: z.string().trim().toLowerCase().email('有効なメールアドレスを入力してください'),
  // パスワード強度は登録時に強制する。ログイン時は空でないことのみ検証する
  password: z.string().min(1, 'パスワードは必須です'),
})

export const registerSchema = z.object({
  // メールアドレスは大文字小文字を区別しない（#44）。検索も登録も小文字で行う
  email: z.string().trim().toLowerCase().email('有効なメールアドレスを入力してください'),
  password: z.string()
    .min(8, 'パスワードは8文字以上である必要があります')
    .regex(/[A-Z]/, '大文字を含める必要があります')
    .regex(/[a-z]/, '小文字を含める必要があります')
    .regex(/[0-9]/, '数字を含める必要があります'),
  name: z.string().min(1, '名前は必須です').max(100),
  // 運営（PLATFORM_ADMIN）を付与できるのは運営だけ。authService.registerService が検証する（#62）
  role: z.enum(['PLATFORM_ADMIN', 'ADMIN', 'MANAGER', 'OPERATOR']).optional(),
  hotelId: entityIdSchema.optional(),
})

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'リフレッシュトークンは必須です'),
})

// ======================================
// Hotel Validators
// ======================================

// ホテル作成（#62）。
// tenantId はリクエストで自由に指定させない — テナント管理者（ADMIN）が他テナントに
// ホテルを作れてしまうため、通常は呼び出し元トークンの tenantId から導出する。
// 運営（PLATFORM_ADMIN）だけは自分の tenantId を持たないので、どのテナントに作るかを
// 指定する手段が必要。そのため optional として受け付け、
// PLATFORM_ADMIN 以外が送った場合は 403、PLATFORM_ADMIN が省いた場合は 400 を
// コントローラ（hotelsController.createHotel）で返す。
export const createHotelSchema = z.object({
  tenantId: entityIdSchema.optional(),
  name: z.string().min(1, 'ホテル名は必須です').max(200),
  address: z.string().max(500).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
  totalRooms: z.number().int().min(1, '部屋数は1以上である必要があります'),
})

export const updateHotelSchema = createHotelSchema.omit({ tenantId: true }).partial()

// ======================================
// Price Rank Validators
// ======================================

// 料金ランクは最大40段階（F-SET-02）
export const createPriceRankSchema = z.object({
  hotelId: entityIdSchema,
  rank: z.number().int().min(1).max(40, '料金ランクは最大40段階です'),
  label: z.string().min(1).max(10),
  price1P: z.number().int().min(0),
  price2P: z.number().int().min(0),
  // 3名・4名料金は「未設定」を null で表現できるようにする。
  // 省略（undefined）は変更なし、null は明示的なクリアを意味する（R-2）
  price3P: z.number().int().min(0).nullable().optional(),
  price4P: z.number().int().min(0).nullable().optional(),
})

export const updatePriceRankSchema = createPriceRankSchema.omit({ hotelId: true, rank: true }).partial()

// ======================================
// Event Validators
// ======================================

const eventBaseSchema = z.object({
  hotelId: entityIdSchema,
  name: z.string().min(1).max(200),
  type: z.string().min(1).max(50),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  location: z.string().max(200).optional(),
  expectedImpact: z.enum(['high', 'medium', 'low']).optional(),
  description: z.string().max(2000).optional(),
})

export const createEventSchema = eventBaseSchema.refine(data => data.startDate <= data.endDate, {
  message: '開始日は終了日以前である必要があります',
})

export const updateEventSchema = eventBaseSchema.omit({ hotelId: true }).partial()

// イベント一覧の検索条件（期間は任意 — F-DP-07）
export const eventsQuerySchema = z.object({
  hotelId: entityIdSchema,
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
}).refine(
  (data) => !data.startDate || !data.endDate || data.startDate <= data.endDate,
  { message: '開始日は終了日以前である必要があります' }
)

// ======================================
// Hotel Settings Validators（F-SET-01）
// ======================================

export const updateHotelSettingsSchema = z.object({
  name: z.string().min(1, 'ホテル名は必須です').max(200).optional(),
  address: z.string().max(500).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
  totalRooms: z.number().int().min(1, '部屋数は1以上である必要があります').optional(),
  // 週末定義（チェックイン日基準の曜日番号、0=日曜〜6=土曜）。デフォルトは金・土 [5, 6]。
  // 空配列を許すと「週末が存在しない」設定になり週末補正・レポートの週末判定が壊れ、
  // 重複を許すと同じ曜日が二重に数えられるため、どちらも弾く（C-11）
  weekendDays: z
    .array(z.number().int().min(0).max(6))
    .min(1, '週末は1曜日以上指定してください')
    .max(7)
    .refine((days) => new Set(days).size === days.length, {
      message: '週末の曜日が重複しています',
    })
    .optional(),
})

// ======================================
// Budget Validators（N-1 / F-SET-04）
// ======================================

/** 予算・前年実績の金額系。null を明示できるようにして「未設定に戻す」操作を表現する */
const budgetAmount = z.number().min(0).nullable().optional()
const budgetCount = z.number().int().min(0).nullable().optional()
/** 稼働率は 0〜1 の比率で保存する（実績側の occupancyRate と同じスケール） */
const budgetRate = z.number().min(0).max(1, '稼働率は0〜1の比率で指定してください').nullable().optional()

export const budgetMonthSchema = z.object({
  month: z.number().int().min(1).max(12),
  budgetRevenue: budgetAmount,
  budgetRooms: budgetCount,
  budgetAdr: budgetAmount,
  budgetOccupancy: budgetRate,
  budgetGuests: budgetCount,
  lastYearRevenue: budgetAmount,
  lastYearRooms: budgetCount,
  lastYearAdr: budgetAmount,
  lastYearOccupancy: budgetRate,
  lastYearGuests: budgetCount,
})

/**
 * 年単位の予算一括更新（N-1）。
 * 12 か月すべてを送る必要はなく、送られた月だけを upsert する。
 * 同じ月を二重に含めると後勝ちになり結果が不定になるため重複は 400 で弾く。
 */
export const upsertBudgetsSchema = z
  .object({
    hotelId: entityIdSchema,
    year: z.number().int().min(2020).max(2100),
    months: z.array(budgetMonthSchema).min(1, '1か月以上指定してください').max(12),
  })
  .refine((data) => new Set(data.months.map((m) => m.month)).size === data.months.length, {
    path: ['months'],
    message: '同じ月が重複しています',
  })

// ======================================
// Competitor Validators（N-2 / F-SET-03）
// ======================================

/**
 * OTA別URL（F-SET-03）。任意のキーを許すと JSON カラムが自由入力になり
 * スクレイピング側の想定と乖離するため、対応OTAのキーに固定する。
 * null は「登録を解除する」意図として許可する。
 */
const otaUrlValue = z.string().url('URLの形式が不正です').max(500).nullable().optional()

export const otaUrlsSchema = z.object({
  rakuten: otaUrlValue,
  jalan: otaUrlValue,
  ikkyu: otaUrlValue,
  expedia: otaUrlValue,
  agoda: otaUrlValue,
})

export const createCompetitorSchema = z.object({
  hotelId: entityIdSchema,
  name: z.string().min(1, '競合ホテル名は必須です').max(200),
  address: z.string().max(500).nullable().optional(),
  category: z.string().max(50).nullable().optional(),
  otaUrls: otaUrlsSchema.nullable().optional(),
})

export const updateCompetitorSchema = createCompetitorSchema.omit({ hotelId: true }).partial()

// ======================================
// User Management Validators（N-3）
// ======================================

export const updateUserSchema = z
  .object({
    name: z.string().min(1, '名前は必須です').max(100).optional(),
    // 運営（PLATFORM_ADMIN）への昇格を許すのは運営だけ。usersService.updateUserService が検証する（#62）
    role: z.enum(['PLATFORM_ADMIN', 'ADMIN', 'MANAGER', 'OPERATOR']).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: '更新する項目を指定してください',
  })

// ======================================
// Alert Validators（N-4）
// ======================================

/**
 * アラートの状態遷移（N-4）。OPEN へ戻す操作は用意しない
 * （検知は自動、解決は人手という運用のため、手動で未対応に戻す必要がない）。
 */
export const updateAlertStatusSchema = z.object({
  hotelId: entityIdSchema,
  status: z.enum(['ACKNOWLEDGED', 'RESOLVED'], {
    errorMap: () => ({ message: 'ステータスは ACKNOWLEDGED または RESOLVED を指定してください' }),
  }),
})

// ======================================
// Query Validators
// ======================================

export const hotelIdQuerySchema = z.object({
  hotelId: entityIdSchema,
})

/**
 * アラート一覧のクエリ（F-DASH-05）
 * minLevel: この値以上の重要度のみ返す。ダッシュボードは4（Level 5・4のみ表示）
 */
export const alertsQuerySchema = z.object({
  hotelId: entityIdSchema,
  minLevel: z.coerce.number().int().min(1).max(5).optional(),
})

export const monthQuerySchema = z.object({
  hotelId: entityIdSchema,
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
})

export const yearQuerySchema = z.object({
  hotelId: entityIdSchema,
  year: z.coerce.number().int().min(2020).max(2100),
})

/**
 * 対象年月を body で受け取る操作系（N-5: スナップショット取得・着地シミュレーション再計算）。
 * クエリ版と違い型変換（coerce）は行わず、JSON の数値のみを受け付ける。
 */
export const monthTargetSchema = z.object({
  hotelId: entityIdSchema,
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
})

export const kpiComparisonQuerySchema = monthQuerySchema.extend({
  baseDate: z.coerce.date().optional(),
})

export const aiSummaryQuerySchema = z.object({
  hotelId: entityIdSchema,
  section: z.string().max(50).optional(),
})

export const bookingCurveQuerySchema = z.object({
  hotelId: entityIdSchema,
  date: z.coerce.date(),
})

export const competitorPricesQuerySchema = z.object({
  hotelId: entityIdSchema,
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
}).refine(data => data.startDate <= data.endDate, {
  message: '開始日は終了日以前である必要があります',
})

// ======================================
// Reports Validators（F-REP-01/02）
// ======================================

export const monthlyReportQuerySchema = z.object({
  hotelId: entityIdSchema,
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  format: z.enum(['pdf', 'excel']),
})

// ======================================
// Forecast Validators（F-DP-05 / F-DP-03）
// ======================================

// 再計算できる期間の上限（C-3）。1日1行を書き込むため、無制限だと
// 1リクエストで何万行も生成でき DB とレスポンス時間を圧迫する。
export const MAX_FORECAST_RANGE_DAYS = 366

export const recomputeForecastSchema = z.object({
  hotelId: entityIdSchema,
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
}).superRefine((data, ctx) => {
  // 需要予測は未来の価格を決めるためのもの。過去日を指定すると確定済み実績の
  // 期間の AI 推奨を書き換えてしまうため、開始日は本日（JST）以降に限る（C-3）
  const start = data.startDate ? dateOnly(data.startDate) : todayJst()
  if (data.startDate && start < todayJst()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['startDate'],
      message: '開始日は本日以降の日付を指定してください',
    })
    return
  }

  if (!data.endDate) return
  const end = dateOnly(data.endDate)

  if (end < start) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
      message: '開始日は終了日以前である必要があります',
    })
    return
  }

  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
  if (days > MAX_FORECAST_RANGE_DAYS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
      message: `再計算できる期間は最大${MAX_FORECAST_RANGE_DAYS}日です`,
    })
  }
})

// 重み付けは合計100%（F-DP-02）
export const updateStrategySchema = z.object({
  hotelId: entityIdSchema,
  weightOccupancy: z.number().int().min(0).max(100),
  weightAdr: z.number().int().min(0).max(100),
  weightCompetitor: z.number().int().min(0).max(100),
}).refine(data => data.weightOccupancy + data.weightAdr + data.weightCompetitor === 100, {
  message: '重み付けの合計は100%である必要があります',
})

// ======================================
// User Preference Validators（#51-2）
// ======================================

// フロントエンドの表示項目キーと一致させる（services/preferencesService.ts の DASHBOARD_KPI_KEYS）
const dashboardKpiItemSchema = z.enum([
  'roomRevenue',
  'soldRooms',
  'adr',
  'occupancyRate',
  'revPar',
  'guests',
  'dor',
  'guestUnitPrice',
])

export const updatePreferencesSchema = z.object({
  hotelId: entityIdSchema,
  dashboard: z.object({
    showTopSitesSection: z.boolean(),
    // 全部外すと進捗表が空になるため最低1件必須
    kpiItems: z.array(dashboardKpiItemSchema).min(1, '表示する指標を1つ以上選択してください'),
  }),
})

// ======================================
// Type Exports
// ======================================

export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
export type CreateHotelInput = z.infer<typeof createHotelSchema>
export type CreatePriceRankInput = z.infer<typeof createPriceRankSchema>
export type UpdateHotelInput = z.infer<typeof updateHotelSchema>
export type CreateEventInput = z.infer<typeof createEventSchema>
export type UpdateEventInput = z.infer<typeof updateEventSchema>
export type UpdateHotelSettingsInput = z.infer<typeof updateHotelSettingsSchema>
export type MonthlyReportQueryInput = z.infer<typeof monthlyReportQuerySchema>
export type RecomputeForecastInput = z.infer<typeof recomputeForecastSchema>
export type BudgetMonthInput = z.infer<typeof budgetMonthSchema>
export type UpsertBudgetsInput = z.infer<typeof upsertBudgetsSchema>
export type CreateCompetitorInput = z.infer<typeof createCompetitorSchema>
export type UpdateCompetitorInput = z.infer<typeof updateCompetitorSchema>
export type UpdateUserInput = z.infer<typeof updateUserSchema>
export type UpdateAlertStatusInput = z.infer<typeof updateAlertStatusSchema>
export type MonthTargetInput = z.infer<typeof monthTargetSchema>
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>
