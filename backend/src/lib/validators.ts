import { z } from 'zod'
import { GROUP_BOOKING_PRESET_KEYS, findGroupBookingPreset } from './groupBookingPresets.js'

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

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export const dateRangeSchema = z.object({
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
}).refine(data => data.startDate <= data.endDate, {
  message: '開始日は終了日以前である必要があります',
})

export const idParamSchema = z.object({
  id: entityIdSchema,
})

// ======================================
// Auth Validators
// ======================================

export const loginSchema = z.object({
  email: z.string().email('有効なメールアドレスを入力してください'),
  // パスワード強度は登録時に強制する。ログイン時は空でないことのみ検証する
  password: z.string().min(1, 'パスワードは必須です'),
  // 組織コード（D-02 / D-08）。サブドメインで特定できる場合は不要
  tenantCode: z.string().max(50).optional(),
})

// 登録・プロビジョニング時に強制するパスワード強度
export const strongPasswordSchema = z.string()
  .min(8, 'パスワードは8文字以上である必要があります')
  .regex(/[A-Z]/, '大文字を含める必要があります')
  .regex(/[a-z]/, '小文字を含める必要があります')
  .regex(/[0-9]/, '数字を含める必要があります')

export const registerSchema = z.object({
  email: z.string().email('有効なメールアドレスを入力してください'),
  password: strongPasswordSchema,
  name: z.string().min(1, '名前は必須です').max(100),
  role: z.enum(['ADMIN', 'MANAGER', 'OPERATOR']).optional(),
  hotelId: entityIdSchema.optional(),
})

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'リフレッシュトークンは必須です'),
})

// 招待・パスワードリセット（SAAS_DECISIONS.md D-04）
export const inviteUserSchema = z.object({
  email: z.string().email('有効なメールアドレスを入力してください'),
  name: z.string().min(1, '名前は必須です').max(100),
  role: z.enum(['MANAGER', 'OPERATOR']),
  hotelId: entityIdSchema,
})

const tokenSchema = z.string().min(1, 'トークンは必須です').max(200)

export const acceptInvitationSchema = z.object({
  token: tokenSchema,
  password: strongPasswordSchema,
})

export const requestPasswordResetSchema = z.object({
  email: z.string().email('有効なメールアドレスを入力してください'),
})

export const resetPasswordSchema = z.object({
  token: tokenSchema,
  password: strongPasswordSchema,
})

// ======================================
// Hotel Validators
// ======================================

export const createHotelSchema = z.object({
  tenantId: entityIdSchema,
  name: z.string().min(1, 'ホテル名は必須です').max(200),
  address: z.string().max(500).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
  totalRooms: z.number().int().min(1, '部屋数は1以上である必要があります'),
})

export const updateHotelSchema = createHotelSchema.omit({ tenantId: true }).partial()

// ======================================
// Room Type Validators
// ======================================

export const createRoomTypeSchema = z.object({
  hotelId: entityIdSchema,
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(50).regex(/^[A-Z0-9_]+$/, 'コードは大文字英数字とアンダースコアのみ使用可能です'),
  capacity: z.number().int().min(1).max(10),
  count: z.number().int().min(0),
  sortOrder: z.number().int().default(0),
})

export const updateRoomTypeSchema = createRoomTypeSchema.omit({ hotelId: true }).partial()

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
  price3P: z.number().int().min(0).optional(),
  price4P: z.number().int().min(0).optional(),
})

export const updatePriceRankSchema = createPriceRankSchema.omit({ hotelId: true, rank: true }).partial()

// 料金ランク自動生成（SAAS_ONBOARDING.md Step 2）:
// 1名利用の下限・上限価格から線形補間で最大40段階を機械生成する
const priceRankGenerationBaseSchema = z.object({
  count: z.number().int().min(1).max(40, '料金ランクは最大40段階です').default(40),
  minPrice1P: z.number().int().min(0),
  maxPrice1P: z.number().int().min(0),
  multiplier2P: z.number().min(1).max(10).default(1.4),
  multiplier3P: z.number().min(1).max(10).default(1.8),
  multiplier4P: z.number().min(1).max(10).optional(),
  // 生成価格の丸め単位（円）。100 なら 100円単位
  roundTo: z.number().int().min(1).max(1000).default(100),
})

const priceRankRangeRefinement = {
  check: (data: { minPrice1P: number; maxPrice1P: number }) => data.minPrice1P <= data.maxPrice1P,
  message: '下限価格は上限価格以下である必要があります',
}

export const priceRankGenerationParamsSchema = priceRankGenerationBaseSchema.refine(
  priceRankRangeRefinement.check,
  { message: priceRankRangeRefinement.message }
)

export const generatePriceRanksSchema = priceRankGenerationBaseSchema.extend({
  hotelId: entityIdSchema,
  // 既存ランクがある場合に置き換えるか。false のまま既存があればエラー（誤爆防止）
  replaceExisting: z.boolean().default(false),
}).refine(priceRankRangeRefinement.check, { message: priceRankRangeRefinement.message })

// ======================================
// User Management Validators
// ======================================

export const updateUserRoleSchema = z.object({
  // ADMIN はシステム提供側専用のため、ホテル側の管理画面からは指定できない
  role: z.enum(['MANAGER', 'OPERATOR'], {
    errorMap: () => ({ message: '権限は MANAGER または OPERATOR を指定してください' }),
  }),
})

export const setUserActiveSchema = z.object({
  isActive: z.boolean(),
})

// ======================================
// Competitor Validators（F-SET-03）
// ======================================

// OTA別URL。空文字は「未設定」として null に正規化する
const otaUrlSchema = z
  .string()
  .max(500)
  .refine((v) => v === '' || /^https?:\/\//.test(v), 'URLは http:// または https:// で始めてください')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional()

const competitorBaseSchema = z.object({
  hotelId: entityIdSchema,
  name: z.string().min(1, '競合ホテル名は必須です').max(200),
  address: z.string().max(500).optional(),
  category: z.string().max(100).optional(),
  otaUrls: z
    .object({
      rakuten: otaUrlSchema,
      jalan: otaUrlSchema,
      ikkyu: otaUrlSchema,
      expedia: otaUrlSchema,
      agoda: otaUrlSchema,
    })
    .partial()
    .optional(),
})

export const createCompetitorSchema = competitorBaseSchema
export const updateCompetitorSchema = competitorBaseSchema
  .omit({ hotelId: true })
  .extend({ isActive: z.boolean().optional() })
  .partial()

// ======================================
// Tenant Master Validators（SAAS_DECISIONS.md D-10）
// ======================================

export const masterKindParamSchema = z.object({
  kind: z.enum(['ota-channel', 'review-source']),
})

export const createMasterSchema = z.object({
  // 実績データの文字列と突き合わせるため、記号を含む表示名も許容する
  code: z.string().min(1, 'コードは必須です').max(100),
  name: z.string().min(1, '名称は必須です').max(100),
  sortOrder: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
})

export const updateMasterSchema = createMasterSchema.omit({ code: true }).partial()

// ======================================
// Group Booking Validators（SAAS_DECISIONS.md D-09 / F-SET-05）
// ======================================

// レベニュー影響ルールはプリセット方式。自由記述にすると施設ごとに解釈が変わり
// 集計・比較ができなくなるため、presetKey をコード定義に限定する
export const revenueImpactRuleSchema = z.object({
  presetKey: z.enum(GROUP_BOOKING_PRESET_KEYS as [string, ...string[]], {
    errorMap: () => ({ message: 'レベニュー影響ルールの種別が不正です' }),
  }),
  params: z.record(z.number()).default({}),
  note: z.string().max(500).optional(),
}).superRefine((value, ctx) => {
  const preset = findGroupBookingPreset(value.presetKey)
  if (!preset) return
  for (const param of preset.params) {
    if (param.required && typeof value.params[param.key] !== 'number') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['params', param.key],
        message: `${preset.label} には「${param.label}」の指定が必要です`,
      })
    }
  }
})

const groupBookingBaseSchema = z.object({
  hotelId: entityIdSchema,
  name: z.string().min(1, '団体名は必須です').max(200),
  stayStartDate: z.coerce.date(),
  stayEndDate: z.coerce.date(),
  rooms: z.number().int().min(1, '室数は1以上である必要があります'),
  guests: z.number().int().min(0).optional(),
  revenueImpactRule: revenueImpactRuleSchema.optional(),
  notes: z.string().max(2000).optional(),
  status: z.enum(['tentative', 'confirmed', 'cancelled']).default('confirmed'),
})

export const createGroupBookingSchema = groupBookingBaseSchema.refine(
  (data) => data.stayStartDate <= data.stayEndDate,
  { message: '開始日は終了日以前である必要があります' }
)

export const updateGroupBookingSchema = groupBookingBaseSchema
  .omit({ hotelId: true })
  .partial()
  .refine(
    (data) => !data.stayStartDate || !data.stayEndDate || data.stayStartDate <= data.stayEndDate,
    { message: '開始日は終了日以前である必要があります' }
  )

export const groupBookingsQuerySchema = z.object({
  hotelId: entityIdSchema,
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
})

// ======================================
// Data Retention Validators（SAAS_DECISIONS.md D-06）
// ======================================

// 保持期間はテナント単位。短すぎる設定で履歴を失わないよう下限を設ける
export const updateRetentionSettingsSchema = z.object({
  auditLogRetentionDays: z.number().int().min(30, '監査ログは30日以上保持してください').max(3650).optional(),
  operationalDataRetentionDays: z.number().int().min(30, '運用ログは30日以上保持してください').max(3650).optional(),
  // null は無期限（既定）。日次実績は収益の元帳にあたるため最低1年
  dailyDataRetentionDays: z.number().int().min(365, '日次実績は365日以上保持してください').max(3650).nullable().optional(),
})

// ======================================
// CSV Import Validators（SAAS_ONBOARDING.md Step 3）
// ======================================

// 行の中身の検証は importService 側の行スキーマで実施する
export const csvImportSchema = z.object({
  hotelId: entityIdSchema,
  csv: z.string().min(1, 'CSVは必須です').max(1_000_000, 'CSVは1MB以内にしてください'),
})

// ======================================
// Tenant Provisioning Validators（SAAS_ONBOARDING.md Step 1）
// ======================================

// 顧客側の初期ユーザー。ADMIN はシステム提供側専用のためここでは作成させない
const provisionUserSchema = z.object({
  email: z.string().email('有効なメールアドレスを入力してください'),
  password: strongPasswordSchema,
  name: z.string().min(1, '名前は必須です').max(100),
  role: z.enum(['MANAGER', 'OPERATOR']),
})

export const provisionTenantSchema = z.object({
  tenant: z.object({
    name: z.string().min(1, 'テナント名は必須です').max(200),
    code: z.string().min(2).max(50).regex(
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
      'テナントコードは英小文字・数字・ハイフンのみ（先頭末尾は英数字）です'
    ),
  }),
  hotel: z.object({
    name: z.string().min(1, 'ホテル名は必須です').max(200),
    address: z.string().max(500).optional(),
    phone: z.string().max(20).optional(),
    email: z.string().email().optional(),
    totalRooms: z.number().int().min(1, '部屋数は1以上である必要があります'),
    // 省略時はDBデフォルトの金・土 [5, 6]
    weekendDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  }),
  users: z.array(provisionUserSchema).min(1, '初期ユーザーは1名以上必要です').max(20),
  // 指定時は料金ランク40段階も同時生成する（Step 2 と同じパラメータ）
  priceRanks: priceRankGenerationParamsSchema.optional(),
}).refine(
  (data) => new Set(data.users.map((u) => u.email)).size === data.users.length,
  { message: '初期ユーザーのメールアドレスが重複しています' }
)

// ======================================
// Daily Data Validators
// ======================================

export const createDailyDataSchema = z.object({
  hotelId: entityIdSchema,
  date: z.coerce.date(),
  occupancy: z.number().min(0).max(1).optional(),
  adr: z.number().min(0).optional(),
  revPar: z.number().min(0).optional(),
  totalRevenue: z.number().min(0).optional(),
  soldRooms: z.number().int().min(0).optional(),
  guests: z.number().int().min(0).optional(),
  budgetOccupancy: z.number().min(0).max(1).optional(),
  budgetAdr: z.number().min(0).optional(),
  budgetRevenue: z.number().min(0).optional(),
  isHoliday: z.boolean().default(false),
  holidayName: z.string().max(100).optional(),
  eventInfo: z.string().max(1000).optional(),
  externalFactors: z.string().max(1000).optional(),
  notes: z.string().max(2000).optional(),
})

export const updateDailyDataSchema = createDailyDataSchema.omit({ hotelId: true, date: true }).partial()

export const bulkUpdateDailyDataSchema = z.object({
  data: z.array(createDailyDataSchema).min(1).max(365),
})

// ======================================
// Campaign Validators
// ======================================

const campaignBaseSchema = z.object({
  hotelId: entityIdSchema,
  name: z.string().min(1).max(200),
  channel: z.string().min(1).max(100),
  source: z.enum(['ota', 'manual']).default('manual'),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  description: z.string().max(2000).optional(),
  targetRooms: z.number().int().min(0).optional(),
})

export const createCampaignSchema = campaignBaseSchema.refine(data => data.startDate <= data.endDate, {
  message: '開始日は終了日以前である必要があります',
})

export const updateCampaignSchema = campaignBaseSchema.omit({ hotelId: true }).partial()

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
  // 週末定義（チェックイン日基準の曜日番号、0=日曜〜6=土曜）。デフォルトは金・土 [5, 6]
  weekendDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
})

// ======================================
// Query Validators
// ======================================

export const dailyDataQuerySchema = z.object({
  hotelId: entityIdSchema,
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  ...paginationSchema.shape,
})

export const pricingQuerySchema = z.object({
  hotelId: entityIdSchema,
  date: z.coerce.date().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2020).max(2100).optional(),
})

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

export const recomputeForecastSchema = z.object({
  hotelId: entityIdSchema,
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
}).refine(
  (data) => !data.startDate || !data.endDate || data.startDate <= data.endDate,
  { message: '開始日は終了日以前である必要があります' }
)

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
// Type Exports
// ======================================

export type LoginInput = z.infer<typeof loginSchema>
export type InviteUserInput = z.infer<typeof inviteUserSchema>
export type CreateGroupBookingInput = z.infer<typeof createGroupBookingSchema>
export type UpdateGroupBookingInput = z.infer<typeof updateGroupBookingSchema>
export type CreateCompetitorInput = z.infer<typeof createCompetitorSchema>
export type UpdateCompetitorInput = z.infer<typeof updateCompetitorSchema>
export type RegisterInput = z.infer<typeof registerSchema>
export type CreateHotelInput = z.infer<typeof createHotelSchema>
export type CreatePriceRankInput = z.infer<typeof createPriceRankSchema>
export type UpdateHotelInput = z.infer<typeof updateHotelSchema>
export type CreateRoomTypeInput = z.infer<typeof createRoomTypeSchema>
export type UpdateRoomTypeInput = z.infer<typeof updateRoomTypeSchema>
export type CreateDailyDataInput = z.infer<typeof createDailyDataSchema>
export type UpdateDailyDataInput = z.infer<typeof updateDailyDataSchema>
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>
export type CreateEventInput = z.infer<typeof createEventSchema>
export type UpdateEventInput = z.infer<typeof updateEventSchema>
export type UpdateHotelSettingsInput = z.infer<typeof updateHotelSettingsSchema>
export type PriceRankGenerationParams = z.infer<typeof priceRankGenerationParamsSchema>
export type GeneratePriceRanksInput = z.infer<typeof generatePriceRanksSchema>
export type ProvisionTenantInput = z.infer<typeof provisionTenantSchema>
export type CsvImportInput = z.infer<typeof csvImportSchema>
export type PaginationInput = z.infer<typeof paginationSchema>
export type DateRangeInput = z.infer<typeof dateRangeSchema>
export type MonthlyReportQueryInput = z.infer<typeof monthlyReportQuerySchema>
export type RecomputeForecastInput = z.infer<typeof recomputeForecastSchema>
