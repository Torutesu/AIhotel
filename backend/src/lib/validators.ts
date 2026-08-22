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
// Type Exports
// ======================================
// Connector Validators（コネクタ連携 — docs/コネクタ連携設計.md §5）
// ======================================

export const syncTargetSchema = z.enum(['LINCOLN', 'NEHOPPS'])

export const syncErrorCodeSchema = z.enum([
  'NETWORK',
  'SESSION_EXPIRED',
  'AUTH_FAILED',
  'CAPTCHA_BLOCKED',
  'SELECTOR_MISMATCH',
  'TARGET_MAINTENANCE',
  'VERIFY_MISMATCH',
  'PRECONDITION_CHANGED',
  'GUARDRAIL_VIOLATION',
  'UNSUPPORTED',
  'UNKNOWN',
])

// 料金ランク1件分（最大40段階 — F-SET-02）
export const syncPriceRankItemSchema = z.object({
  rank: z.number().int().min(1).max(40),
  label: z.string().max(50).optional(),
  price1P: z.number().int().positive(),
  price2P: z.number().int().positive(),
  price3P: z.number().int().positive().nullable().optional(),
  price4P: z.number().int().positive().nullable().optional(),
})

export const readJobPayloadSchema = z.object({
  kind: z.literal('PRICE_RANKS'),
})

export const writeJobPayloadSchema = z.object({
  kind: z.literal('PRICE_RANKS'),
  items: z.array(syncPriceRankItemSchema).min(1).max(40),
})

export const pairDeviceSchema = z.object({
  code: z.string().length(32).regex(/^[0-9a-f]+$/, 'ペアリングコードの形式が不正です'),
  agentVersion: z.string().max(50).optional(),
})

export const heartbeatSchema = z.object({
  agentVersion: z.string().max(50).optional(),
})

export const jobResultSchema = z
  .object({
    status: z.enum(['DONE', 'FAILED', 'NEEDS_REVIEW']),
    errorCode: syncErrorCodeSchema.optional(),
    errorMessage: z.string().max(2000).optional(),
    readData: z
      .object({
        kind: z.literal('PRICE_RANKS'),
        capturedAt: z.string().datetime(),
        items: z.array(syncPriceRankItemSchema).min(1).max(40),
      })
      .optional(),
    writeVerification: z
      .object({
        verifiedAt: z.string().datetime(),
        itemResults: z.array(
          z.object({
            rank: z.number().int().min(1).max(40),
            ok: z.boolean(),
            message: z.string().max(500).optional(),
          })
        ),
      })
      .optional(),
  })
  .refine((data) => data.status === 'DONE' || data.errorCode !== undefined, {
    message: '失敗報告には errorCode が必要です',
    path: ['errorCode'],
  })

// 証跡は base64 で最大8MB相当（express の body 上限 10mb と整合）。
// sanitized は literal(true) — 未サニタイズの証跡はスキーマレベルで受理しない（§12）
export const jobArtifactSchema = z.object({
  kind: z.enum(['READ_RAW', 'PRE_WRITE', 'POST_WRITE', 'FAILURE_EVIDENCE']),
  contentType: z.enum(['text/html', 'image/png', 'application/json']),
  dataBase64: z.string().min(1).max(8_000_000),
  capturedAt: z.string().datetime(),
  sanitized: z.literal(true, {
    errorMap: () => ({ message: 'サニタイズ済み（sanitized: true）の証跡のみ受理します' }),
  }),
})

export const definitionsQuerySchema = z.object({
  target: syncTargetSchema,
})

export const issuePairingCodeSchema = z.object({
  deviceName: z.string().min(1, 'デバイス名は必須です').max(100),
  deviceRole: z.enum(['PRIMARY', 'STANDBY']).optional(),
})

export const createSyncJobSchema = z
  .object({
    target: syncTargetSchema,
    direction: z.enum(['READ', 'WRITE']),
    payload: z.union([writeJobPayloadSchema, readJobPayloadSchema]),
    dryRun: z.boolean().optional(),
    priority: z.number().int().min(-10).max(10).optional(),
    expiresAt: z.coerce.date().optional(),
  })
  .refine((data) => data.direction === 'READ' || 'items' in data.payload, {
    message: 'WRITEジョブのpayloadにはitemsが必要です',
    path: ['payload'],
  })

export const writeFreezeSchema = z.object({
  frozen: z.boolean(),
  reason: z.string().max(200).optional(),
})

export const listSyncJobsQuerySchema = z.object({
  status: z.enum(['PENDING', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED', 'NEEDS_REVIEW']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

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
export type PairDeviceInput = z.infer<typeof pairDeviceSchema>
export type JobResultInputSchema = z.infer<typeof jobResultSchema>
export type JobArtifactInput = z.infer<typeof jobArtifactSchema>
export type IssuePairingCodeInput = z.infer<typeof issuePairingCodeSchema>
export type CreateSyncJobSchemaInput = z.infer<typeof createSyncJobSchema>
export type WriteFreezeInput = z.infer<typeof writeFreezeSchema>
