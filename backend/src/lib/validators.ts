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
  expectedImpact: z.enum(['high', 'medium', 'low', 'negative']).optional(),
  description: z.string().max(2000).optional(),
  // 会場マスタ（docs/外部要因設計.md §3 #3）。会場があり expectedImpact が無ければ収容人数・距離から推定する
  venueId: entityIdSchema.nullable().optional(),
  expectedAttendance: z.number().int().min(0).nullable().optional(),
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
  // 省略時は candidate 以外（confirmed のみ表示）。'all' で候補・却下も含む
  status: z.enum(['confirmed', 'candidate', 'rejected', 'all']).optional(),
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
  // 天候シグナル取得用（気象庁 府県予報区コード6桁 / 一次細分区域コード6桁、緯度経度）。null でクリア
  jmaOfficeCode: z.string().regex(/^\d{6}$/, '気象庁の府県予報区コードは6桁の数字です').nullable().optional(),
  jmaAreaCode: z.string().regex(/^\d{6}$/, '気象庁の一次細分区域コードは6桁の数字です').nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  // LLM の選択（null で環境変数の既定に戻す）
  llmProvider: z.enum(['anthropic', 'openai']).nullable().optional(),
  llmModel: z.string().min(1).max(100).nullable().optional(),
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

// 重み付けは合計100%（F-DP-02）。ガードレール（docs/外部要因設計.md §2.2）は任意
export const updateStrategySchema = z.object({
  hotelId: entityIdSchema,
  weightOccupancy: z.number().int().min(0).max(100),
  weightAdr: z.number().int().min(0).max(100),
  weightCompetitor: z.number().int().min(0).max(100),
  minRank: z.number().int().min(1).max(40).optional(),
  maxRank: z.number().int().min(1).max(40).optional(),
  maxDailyRankChange: z.number().int().min(1).max(40).optional(),
  competitorPositionPct: z.number().int().min(-50).max(50).optional(),
  // 自動採用モード（docs/外部要因設計.md §6 #6）
  autoAdopt: z.boolean().optional(),
  autoAdoptMinConfidence: z.number().min(0).max(1).optional(),
  autoAdoptMaxLeadDays: z.number().int().min(0).max(365).optional(),
}).refine(data => data.weightOccupancy + data.weightAdr + data.weightCompetitor === 100, {
  message: '重み付けの合計は100%である必要があります',
}).refine(data => data.minRank == null || data.maxRank == null || data.minRank <= data.maxRank, {
  message: '最小ランクは最大ランク以下である必要があります',
})

// ======================================
// Venues / Event Candidates Validators（docs/外部要因設計.md §3 #3）
// ======================================

const venueBaseSchema = z.object({
  hotelId: entityIdSchema,
  name: z.string().min(1).max(200),
  category: z.enum(['dome', 'arena', 'hall', 'stadium', 'exhibition', 'other']).optional(),
  address: z.string().max(500).optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  capacity: z.number().int().min(0).nullable().optional(),
  distanceKm: z.number().min(0).max(500).nullable().optional(),
  websiteUrl: z.string().url().max(1000).nullable().optional(),
  isActive: z.boolean().optional(),
})
export const createVenueSchema = venueBaseSchema
export const updateVenueSchema = venueBaseSchema.omit({ hotelId: true }).partial()

export const reviewEventCandidateSchema = z.object({
  hotelId: entityIdSchema,
  decision: z.enum(['approve', 'reject']),
  name: z.string().min(1).max(200).optional(),
  type: z.string().min(1).max(50).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  expectedImpact: z.enum(['high', 'medium', 'low', 'negative']).optional(),
}).refine((data) => !data.startDate || !data.endDate || data.startDate <= data.endDate, {
  message: '開始日は終了日以前である必要があります',
})

export const detectCandidatesSchema = z.object({
  hotelId: entityIdSchema,
  lookbackDays: z.number().int().min(60).max(800).optional(),
})

export const llmProviderSchema = z.enum(['anthropic', 'openai'])

export const extractVenueSchema = z.object({
  hotelId: entityIdSchema,
  // 任意: この実行だけ LLM を切り替える（既定はホテル設定 → 環境変数）
  llmProvider: llmProviderSchema.optional(),
  llmModel: z.string().min(1).max(100).optional(),
})

// ======================================
// Decisions / Digest / Learning Validators（docs/外部要因設計.md §5, §6）
// ======================================

export const recordDecisionSchema = z.object({
  hotelId: entityIdSchema,
  date: z.coerce.date(),
  appliedRank: z.number().int().min(1).max(40),
  reason: z.string().max(500).optional(),
})

export const decisionsQuerySchema = z.object({
  hotelId: entityIdSchema,
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
}).refine((data) => data.startDate <= data.endDate, {
  message: '開始日は終了日以前である必要があります',
})

export const learnSchema = z.object({
  hotelId: entityIdSchema,
})

export const backtestSchema = z.object({
  hotelId: entityIdSchema,
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  leadDays: z.array(z.number().int().min(0).max(365)).min(1).max(6).optional(),
}).refine((data) => data.startDate <= data.endDate, {
  message: '開始日は終了日以前である必要があります',
})

export const evaluationQuerySchema = z.object({
  hotelId: entityIdSchema,
  lookbackDays: z.coerce.number().int().min(14).max(730).optional(),
})

export const soldOutIgnoreSchema = z.object({
  hotelId: entityIdSchema,
  competitorId: entityIdSchema,
  date: z.coerce.date(),
  ignored: z.boolean(),
  reason: z.string().max(300).optional(),
})

export const knowledgeSearchSchema = z.object({
  q: z.string().min(1).max(300),
  k: z.coerce.number().int().min(1).max(20).optional(),
})

export const chatMessageSchema = z.object({
  hotelId: entityIdSchema,
  conversationId: entityIdSchema.optional(),
  content: z.string().min(1).max(4000),
  llmProvider: z.enum(['anthropic', 'openai']).optional(),
  llmModel: z.string().min(1).max(100).optional(),
})

export const generateAiSummarySchema = z.object({
  hotelId: entityIdSchema,
  section: z.string().min(1).max(50).optional(),
  llmProvider: z.enum(['anthropic', 'openai']).optional(),
  llmModel: z.string().min(1).max(100).optional(),
})

export const dailyJobSchema = z.object({
  hotelId: entityIdSchema.optional(),
})

// ======================================
// External Signals Validators（docs/外部要因設計.md §3）
// ======================================

export const signalsQuerySchema = z.object({
  hotelId: entityIdSchema,
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
}).refine((data) => data.startDate <= data.endDate, {
  message: '開始日は終了日以前である必要があります',
}).refine((data) => (data.endDate.getTime() - data.startDate.getTime()) / 86_400_000 <= 366, {
  message: '期間は366日以内で指定してください',
})

export const ingestSignalsSchema = z.object({
  hotelId: entityIdSchema,
})

// ======================================
// Integrations Validators（PMS/OTA 連携の器 — docs/外部要因設計.md P2-11）
// ======================================

const isoDate = z.coerce.date()

export const otbImportSchema = z.object({
  hotelId: entityIdSchema,
  capturedAt: z.coerce.date().optional(),
  // JSON 行 か CSV テキスト（ヘッダ: stayDate,roomsBooked[,daysBefore]）のどちらか
  rows: z.array(z.object({
    stayDate: isoDate,
    roomsBooked: z.number().int().min(0),
    daysBefore: z.number().int().min(0).max(400).optional(),
  })).max(5000).optional(),
  csv: z.string().max(2_000_000).optional(),
}).refine((d) => (d.rows && d.rows.length > 0) || (d.csv && d.csv.trim().length > 0), {
  message: 'rows か csv のどちらかが必要です',
})

export const competitorPricesImportSchema = z.object({
  hotelId: entityIdSchema,
  // JSON 行 か CSV テキスト（ヘッダ: competitorName,date,price1P,price2P,price3P,soldOut）
  rows: z.array(z.object({
    competitorId: entityIdSchema.optional(),
    competitorName: z.string().min(1).max(200).optional(),
    date: isoDate,
    price1P: z.number().int().min(0).nullable().optional(),
    price2P: z.number().int().min(0).nullable().optional(),
    price3P: z.number().int().min(0).nullable().optional(),
    soldOut: z.boolean().optional(),
    dataSource: z.string().max(50).optional(),
    reliability: z.enum(['high', 'medium', 'low']).optional(),
  })).max(5000).optional(),
  csv: z.string().max(2_000_000).optional(),
}).refine((d) => (d.rows && d.rows.length > 0) || (d.csv && d.csv.trim().length > 0), {
  message: 'rows か csv のどちらかが必要です',
})

// ======================================
// Forecast Models Validators（チャンピオン/チャレンジャー — docs/外部要因設計.md §5.2 L2）
// ======================================

export const modelNameSchema = z.enum(['rule-based-v2', 'ridge-v1'])

export const trainModelSchema = z.object({
  hotelId: entityIdSchema,
  modelName: modelNameSchema.default('ridge-v1'),
})

export const compareModelsSchema = z.object({
  hotelId: entityIdSchema,
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  leadDays: z.array(z.number().int().min(0).max(365)).min(1).max(6).optional(),
})

export const promoteModelSchema = z.object({
  hotelId: entityIdSchema,
  modelName: modelNameSchema,
  // バックテストの門番を無視して昇格（ADMIN が明示したときのみ）
  force: z.boolean().optional(),
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
export type UpdateStrategyInput = z.infer<typeof updateStrategySchema>
export type RecordDecisionInput = z.infer<typeof recordDecisionSchema>
export type CreateVenueInput = z.infer<typeof createVenueSchema>
export type UpdateVenueInput = z.infer<typeof updateVenueSchema>
export type ReviewEventCandidateInput = z.infer<typeof reviewEventCandidateSchema>
