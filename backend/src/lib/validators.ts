import { z } from 'zod'

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
})

export const registerSchema = z.object({
  email: z.string().email('有効なメールアドレスを入力してください'),
  password: z.string()
    .min(8, 'パスワードは8文字以上である必要があります')
    .regex(/[A-Z]/, '大文字を含める必要があります')
    .regex(/[a-z]/, '小文字を含める必要があります')
    .regex(/[0-9]/, '数字を含める必要があります'),
  name: z.string().min(1, '名前は必須です').max(100),
  role: z.enum(['ADMIN', 'MANAGER', 'OPERATOR']).optional(),
  hotelId: entityIdSchema.optional(),
})

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'リフレッシュトークンは必須です'),
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
// 運営担当者の意向・差異・継続学習 Validators（F-DP-08 / F-DP-09 / F-DP-10）
// ======================================

// Prisma の PriceIntentReason と対応。増減時は schema.prisma と揃えること
export const PRICE_INTENT_REASONS = [
  'FOLLOW_AI',
  'COMPETITOR_MOVE',
  'EVENT_DEMAND',
  'GROUP_BLOCK',
  'OTA_CAMPAIGN',
  'BUDGET_PRESSURE',
  'FIELD_INSIGHT',
  'OPERATION_LIMIT',
  'OTHER',
] as const

// 判断種別（ACCEPTED/RAISED/LOWERED）はサーバ側でAI推奨との差から導出するため受け取らない
export const createPriceDecisionSchema = z.object({
  hotelId: entityIdSchema,
  date: z.coerce.date(),
  roomTypeId: entityIdSchema.optional(),
  // 料金ランクは最大40段階（F-SET-02）
  appliedRank: z.number().int().min(1).max(40).optional(),
  appliedPrice: z.number().int().min(0).optional(),
  intentReason: z.enum(PRICE_INTENT_REASONS),
  intentNote: z.string().max(1000).optional(),
}).refine((data) => data.appliedRank != null || data.appliedPrice != null, {
  message: '適用した料金ランクまたは価格のいずれかは必須です',
})

export const priceDecisionsQuerySchema = z.object({
  hotelId: entityIdSchema,
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
}).refine(
  (data) => !data.startDate || !data.endDate || data.startDate <= data.endDate,
  { message: '開始日は終了日以前である必要があります' }
)

export const recomputePreferenceProfilesSchema = z.object({
  hotelId: entityIdSchema,
  // 学習に使う過去日数（30日〜2年）
  lookbackDays: z.number().int().min(30).max(730).optional(),
})

export const updatePreferenceProfileSchema = z.object({
  hotelId: entityIdSchema,
  isEnabled: z.boolean(),
})

// ======================================
// AI予測とレベニュー担当予測の差異 Validators（F-DP-11 / F-DP-12）
// ======================================

// Prisma の ForecastVarianceReason と対応。増減時は schema.prisma と揃えること
export const FORECAST_VARIANCE_REASONS = [
  'BOOKING_PACE',
  'COMPETITOR_SUPPLY',
  'EVENT_LOCAL',
  'GROUP_CONTRACT',
  'REPEAT_GUEST',
  'MARKET_TREND',
  'OTA_CAMPAIGN',
  'RENOVATION_OPS',
  'DATA_DOUBT',
  'OTHER',
] as const

// 担当者は「稼働率＋ADR」でも「販売室数＋売上」でも入力できる。
// 欠けている指標はホテルの総室数からサーバ側で導出する
export const operatorForecastEntrySchema = z.object({
  date: z.coerce.date(),
  occupancy: z.number().min(0).max(1).optional(),
  adr: z.number().min(0).optional(),
  soldRooms: z.number().int().min(0).optional(),
  revenue: z.number().min(0).optional(),
  varianceReason: z.enum(FORECAST_VARIANCE_REASONS).optional(),
  varianceNote: z.string().max(1000).optional(),
}).refine(
  (data) =>
    data.occupancy != null || data.adr != null || data.soldRooms != null || data.revenue != null,
  { message: '稼働率・ADR・販売室数・売上のいずれかは入力が必要です' }
)

// 乖離が閾値を超えた日の意図・背景（varianceReason）必須チェックは
// ホテル別の閾値設定に依存するため、zodではなくサービス層で検証する
export const saveOperatorForecastsSchema = z.object({
  hotelId: entityIdSchema,
  entries: z.array(operatorForecastEntrySchema).min(1).max(366),
})

export const operatorForecastsQuerySchema = z.object({
  hotelId: entityIdSchema,
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
}).refine((data) => data.startDate <= data.endDate, {
  message: '開始日は終了日以前である必要があります',
})

// 閾値は割合で保持する（稼働率は pt 換算: 0.05 = 5pt）
export const updateVarianceSettingSchema = z.object({
  hotelId: entityIdSchema,
  occupancyPtThreshold: z.number().min(0).max(1),
  adrPctThreshold: z.number().min(0).max(1),
  revenuePctThreshold: z.number().min(0).max(1),
})

// ======================================
// Type Exports
// ======================================

export type LoginInput = z.infer<typeof loginSchema>
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
export type PaginationInput = z.infer<typeof paginationSchema>
export type DateRangeInput = z.infer<typeof dateRangeSchema>
export type MonthlyReportQueryInput = z.infer<typeof monthlyReportQuerySchema>
export type RecomputeForecastInput = z.infer<typeof recomputeForecastSchema>
export type CreatePriceDecisionInput = z.infer<typeof createPriceDecisionSchema>
export type PriceDecisionsQueryInput = z.infer<typeof priceDecisionsQuerySchema>
export type RecomputePreferenceProfilesInput = z.infer<typeof recomputePreferenceProfilesSchema>
export type UpdatePreferenceProfileInput = z.infer<typeof updatePreferenceProfileSchema>
export type SaveOperatorForecastsInput = z.infer<typeof saveOperatorForecastsSchema>
export type OperatorForecastsQueryInput = z.infer<typeof operatorForecastsQuerySchema>
export type UpdateVarianceSettingInput = z.infer<typeof updateVarianceSettingSchema>
