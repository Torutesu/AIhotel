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

// 料金ランク（F-SET-02 — 部屋タイプ×レート区分×ランクコード。旧40段階制約は撤廃）
export const rateCategorySchema = z.enum(['OWN', 'MEMBER', 'SHAREHOLDER', 'OTA'])

// ランクコードは "65".."0" の数値表記と "★1".."★5" を許容する
export const rankCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(8)
  .regex(/^(\d{1,3}|★[1-9])$/, 'ランクコードは数値または★1〜★9の形式です')

// 価格は100円単位（機能リスト: 500円幅→100円単位へ）
const rankPriceSchema = z
  .number()
  .int()
  .min(0)
  .max(10_000_000)
  .refine((v) => v % 100 === 0, { message: '価格は100円単位で指定してください' })

export const createPriceRankSchema = z.object({
  hotelId: entityIdSchema,
  roomTypeId: entityIdSchema,
  rateCategory: rateCategorySchema,
  rankCode: rankCodeSchema,
  sortOrder: z.number().int().min(0).max(1000),
  price: rankPriceSchema,
})

export const updatePriceRankSchema = z.object({
  price: rankPriceSchema.optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  isActive: z.boolean().optional(),
})

// 料金ランク一覧の絞り込み
export const priceRanksQuerySchema = z.object({
  hotelId: entityIdSchema,
  roomTypeId: entityIdSchema.optional(),
  rateCategory: rateCategorySchema.optional(),
})

// 料金表の一括登録（販売料金表の取込・編集用）
export const bulkUpsertPriceRanksSchema = z.object({
  hotelId: entityIdSchema,
  roomTypeId: entityIdSchema,
  rateCategory: rateCategorySchema,
  items: z
    .array(
      z.object({
        rankCode: rankCodeSchema,
        sortOrder: z.number().int().min(0).max(1000),
        price: rankPriceSchema,
        isActive: z.boolean().optional(),
      })
    )
    .min(1)
    .max(200),
})

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

export const monthQuerySchema = z.object({
  hotelId: entityIdSchema,
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
})

// 価格カレンダー（F-DP-01）。表示は1ヶ月固定のため year/month は必須。
// 部屋タイプ未指定時はマスタ先頭を既定にする（モックアップ修正 ②）
export const pricingCalendarQuerySchema = monthQuerySchema.extend({
  roomTypeId: entityIdSchema.optional(),
  rateCategory: z.enum(['OWN', 'MEMBER', 'SHAREHOLDER', 'OTA']).optional(),
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

// 価格戦略の重み付け設定（旧 updateStrategySchema）は2026/8に撤去した
// （モックアップ修正内容.xlsx ③ / docs/drive-gap-analysis.md §3-3）

// ======================================
// PMS Ingest / Segment Master Validators（Phase 4A — F-OH-01, F-INV-01, F-SET-06, F-ING-01）
// ======================================

// PMSコード（部屋タイプ・マーケット・地域等）。全角を含むPMSもあるため文字種は縛らない
const pmsCodeSchema = z.string().trim().min(1).max(32)
const pmsCodeOptionalSchema = z.string().trim().min(1).max(32).optional()

// 宿泊実績1泊明細（計上日単位 — HG月次データ形式）
export const ingestNightRowSchema = z.object({
  stayDate: z.coerce.date(), // 計上日
  roomTypeCode: pmsCodeSchema,
  rateTypeCode: pmsCodeOptionalSchema,
  packageCode: pmsCodeOptionalSchema,
  rooms: z.number().int().min(0),
  guests: z.number().int().min(0).optional(),
  guestsDetail: z.record(z.string(), z.number()).optional(), // {male, female, child} 等
  roomRevenue: z.number().finite().optional(), // 室料NET
  serviceFee: z.number().finite().optional(),
  agentCode: pmsCodeOptionalSchema,
  regionCode: pmsCodeOptionalSchema,
  marketCode: pmsCodeOptionalSchema,
  individualGroupType: z.string().trim().min(1).max(8).optional(), // I/G 等
  buildingCode: pmsCodeOptionalSchema,
  blockCode: pmsCodeOptionalSchema,
  checkIn: z.coerce.date().optional(),
  checkOut: z.coerce.date().optional(),
  isDayUse: z.boolean().optional(),
  compHuType: z.string().trim().min(1).max(16).optional(),
})

// 実績明細の取込（対象日単位で全量置換。1リクエスト最大4万行 — 月次一括はチャンク分割して送る）
export const ingestNightsSchema = z.object({
  hotelId: entityIdSchema,
  rows: z.array(ingestNightRowSchema).min(1).max(40000),
})

// オンハンド予約明細（180日分の断面 — 仕様書Ⅲ章3.3）
export const ingestReservationRowSchema = z
  .object({
    bookedAt: z.coerce.date().optional(), // 予約日
    cancelledAt: z.coerce.date().optional(), // キャンセル日
    checkIn: z.coerce.date(),
    checkOut: z.coerce.date(),
    roomTypeCode: pmsCodeSchema,
    rateTypeCode: pmsCodeOptionalSchema,
    packageCode: pmsCodeOptionalSchema,
    rooms: z.number().int().min(1),
    guests: z.number().int().min(0).optional(),
    roomRevenue: z.number().finite().optional(), // 室料NET（滞在合計）
    serviceFee: z.number().finite().optional(),
    agentCode: pmsCodeOptionalSchema,
    regionCode: pmsCodeOptionalSchema,
    marketCode: pmsCodeOptionalSchema,
    isGroup: z.boolean().optional(),
  })
  .refine((r) => r.checkOut > r.checkIn, {
    message: 'チェックアウト日はチェックイン日より後である必要があります',
  })

export const ingestReservationsSchema = z.object({
  hotelId: entityIdSchema,
  capturedDate: z.coerce.date(), // このオンハンド断面の取得日
  rows: z.array(ingestReservationRowSchema).min(1).max(40000),
})

// 残室スナップショット（日別×タイプ別 — F-INV-01）
export const ingestInventoryRowSchema = z.object({
  stayDate: z.coerce.date(),
  roomTypeCode: pmsCodeSchema,
  remainingRooms: z.number().int().min(0),
  totalRooms: z.number().int().min(0).optional(),
})

export const ingestInventorySchema = z.object({
  hotelId: entityIdSchema,
  capturedDate: z.coerce.date(),
  rows: z.array(ingestInventoryRowSchema).min(1).max(20000),
})

export const ingestLogsQuerySchema = z.object({
  hotelId: entityIdSchema,
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

// ファイル取込（F-ING-01 — docs/pms-ingest-design.md §A-2④）
// 取得手段（RPA/ネイティブ自動化/SC連携/手動）を問わない共通の入口。
// 本文JSONのサイズ上限（express.json 10mb）に収まるサイズのファイルを対象とする。
export const fileIngestSchema = z
  .object({
    hotelId: entityIdSchema,
    /** lib/ingestProfiles.ts の ID */
    profileId: z.string().trim().min(1).max(64),
    dataset: z.enum(['nights', 'reservations', 'inventory', 'segments']),
    fileName: z.string().trim().min(1).max(255),
    /** ファイル本体（base64）。約7MBまで */
    contentBase64: z.string().min(1).max(10_000_000),
    /** reservations / inventory では必須（断面の取得日） */
    capturedDate: z.coerce.date().optional(),
    /** true なら検証のみ行いDBへ書き込まない（導入時のマッピング確認用） */
    dryRun: z.coerce.boolean().optional().default(false),
  })
  .refine((d) => d.dataset === 'nights' || d.dataset === 'segments' || d.dryRun || d.capturedDate != null, {
    message: 'オンハンド予約・残室の取込には capturedDate が必要です',
    path: ['capturedDate'],
  })

// セグメントマスタ（F-SET-06）
export const segmentKindSchema = z.enum([
  'SOURCE',
  'CHANNEL',
  'MARKET',
  'REGION',
  'AGENT',
  'RATE_TYPE',
  'ROOM_GROUP',
  'CHANNEL_GROUP',
  'REGION_GROUP',
])

export const segmentsQuerySchema = z.object({
  hotelId: entityIdSchema,
  kind: segmentKindSchema.optional(),
})

export const upsertSegmentsSchema = z.object({
  hotelId: entityIdSchema,
  kind: segmentKindSchema,
  items: z
    .array(
      z.object({
        code: pmsCodeSchema,
        name: z.string().trim().min(1).max(100),
        aggregateCode: z.string().trim().min(1).max(32).optional(),
        attributes: z.record(z.string(), z.unknown()).optional(),
        sortOrder: z.number().int().min(0).optional(),
        isActive: z.boolean().optional(),
      })
    )
    .min(1)
    .max(1000),
})

// ======================================
// 分析拡張 Validators（Phase 4B — F-CXL-01, F-TOP-01, F-OH-03, F-INV-01）
// ======================================

// 期間比較(FROM-TO)。日数上限は1年（機能リスト: 月別/日別/年間）
export const periodQuerySchema = z
  .object({
    hotelId: entityIdSchema,
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    compareLastYear: z.coerce.boolean().optional().default(false),
  })
  .refine((d) => d.startDate <= d.endDate, {
    message: '開始日は終了日以前である必要があります',
  })

// キャンセル分析（F-CXL-01）: 日別/月別 × 室数・件数・室料売上
export const cancellationQuerySchema = periodQuerySchema.innerType().extend({
  granularity: z.enum(['daily', 'monthly']).default('daily'),
  compareLastYear: z.coerce.boolean().optional().default(false),
}).refine((d) => d.startDate <= d.endDate, {
  message: '開始日は終了日以前である必要があります',
})

// セグメント別分析（F-TOP-01）: 集計軸と指標
export const segmentAxisSchema = z.enum([
  'roomType',
  'market',
  'region',
  'agent',
  'rateType',
  'guests',
  'individualGroup',
])

export const segmentAnalysisQuerySchema = periodQuerySchema.innerType().extend({
  axis: segmentAxisSchema,
  // 上位表示（既定10位 — 機能リスト「※表示数は要確認事項」のためパラメータ化）
  limit: z.coerce.number().int().min(1).max(100).default(10),
  compareLastYear: z.coerce.boolean().optional().default(false),
}).refine((d) => d.startDate <= d.endDate, {
  message: '開始日は終了日以前である必要があります',
})

// 上位・下位分析（F-TOP-01）: 日別ADR / 日別稼働率
export const rankingQuerySchema = periodQuerySchema.innerType().extend({
  metric: z.enum(['adr', 'occupancy']).default('adr'),
  limit: z.coerce.number().int().min(1).max(100).default(10),
}).refine((d) => d.startDate <= d.endDate, {
  message: '開始日は終了日以前である必要があります',
})

// オンハンド ブッキングカーブ（F-OH-03）: 宿泊日 or 対象月のリードタイム別推移
export const onHandCurveQuerySchema = z
  .object({
    hotelId: entityIdSchema,
    stayDate: z.coerce.date().optional(),
    year: z.coerce.number().int().min(2020).max(2100).optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
    // 進捗管理表と同じ10日刻みを既定にする（【進捗管理】5日間・10日間.xlsx）
    step: z.coerce.number().int().min(1).max(30).default(10),
    maxDaysBefore: z.coerce.number().int().min(10).max(400).default(360),
    compareLastYear: z.coerce.boolean().optional().default(false),
  })
  .refine((d) => d.stayDate != null || (d.year != null && d.month != null), {
    message: 'stayDate、または year と month の指定が必要です',
  })

// 残室ビュー（F-INV-01）
export const inventoryQuerySchema = z
  .object({
    hotelId: entityIdSchema,
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    capturedDate: z.coerce.date().optional(), // 省略時は最新断面
    comparePrevious: z.coerce.boolean().optional().default(true), // 前回断面との差異
  })
  .refine((d) => d.startDate <= d.endDate, {
    message: '開始日は終了日以前である必要があります',
  })

// 取込スケジュール（F-ING-01 — 未着検知）
export const ingestSourceSchema = z.enum([
  'pms-nights',
  'pms-reservations',
  'pms-inventory',
  'segments',
])

export const upsertIngestSchedulesSchema = z.object({
  hotelId: entityIdSchema,
  items: z
    .array(
      z.object({
        source: ingestSourceSchema,
        profileId: z.string().trim().min(1).max(64).optional(),
        /** 期待到着時刻 HH:MM（24時間表記） */
        expectedAt: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/, '時刻は HH:MM 形式で指定してください'),
        /** expectedAt を解釈するタイムゾーン（IANA名）。省略時はホテル現地=東京 */
        timeZone: z
          .string()
          .trim()
          .min(1)
          .max(64)
          .refine((tz) => {
            try {
              new Intl.DateTimeFormat('en-US', { timeZone: tz })
              return true
            } catch {
              return false
            }
          }, '不明なタイムゾーンです')
          .optional(),
        graceMinutes: z.number().int().min(0).max(1440).optional(),
        enabled: z.boolean().optional(),
        /** 自動取得の方式。null / 省略で「外部からのpushを待つ（監視のみ）」 */
        connector: z.enum(['LOCAL_DIR', 'HTTPS']).nullable().optional(),
        /** 方式ごとの設定。中身は lib/ingestConnectors.ts のスキーマで別途検証する */
        connectorConfig: z.record(z.unknown()).nullable().optional(),
      })
    )
    .min(1)
    .max(10),
})

export const runIngestSchema = z.object({
  hotelId: entityIdSchema,
  /** 省略時は該当ホテルの自動取得スケジュールすべて */
  source: ingestSourceSchema.optional(),
})

// ======================================
// 特日・外部要因 Validators（Phase 4C — F-DP-08, F-EXT-01）
// ======================================

export const specialDayKindSchema = z.enum(['HOLIDAY', 'TOKUJITSU'])
export const dataSourceSchema = z.enum(['AI', 'MANUAL'])

export const specialDaysQuerySchema = z
  .object({
    hotelId: entityIdSchema,
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  })
  .refine((d) => d.startDate <= d.endDate, {
    message: '開始日は終了日以前である必要があります',
  })

export const createSpecialDaySchema = z.object({
  hotelId: entityIdSchema,
  date: z.coerce.date(),
  name: z.string().trim().min(1).max(50),
  kind: specialDayKindSchema,
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, '色は #RRGGBB 形式で指定してください')
    .optional(),
  note: z.string().max(200).optional(),
})

export const updateSpecialDaySchema = createSpecialDaySchema
  .omit({ hotelId: true, date: true })
  .partial()

export const factorCategorySchema = z.enum([
  'WEATHER',
  'INBOUND',
  'EVENT',
  'ACCESS',
  'NEW_HOTEL',
  'ECONOMY',
  'OTHER',
])
export const factorTimeAxisSchema = z.enum(['TOKUJITSU', 'PERIOD', 'DAILY'])

export const externalFactorsQuerySchema = z
  .object({
    hotelId: entityIdSchema,
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    category: factorCategorySchema.optional(),
  })
  .refine((d) => d.startDate <= d.endDate, {
    message: '開始日は終了日以前である必要があります',
  })

export const createExternalFactorSchema = z
  .object({
    hotelId: entityIdSchema,
    category: factorCategorySchema,
    timeAxis: factorTimeAxisSchema,
    title: z.string().trim().min(1).max(120),
    description: z.string().max(1000).optional(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    impactScore: z.number().min(-1).max(1).optional(),
    area: z.string().max(50).optional(),
    sourceUrl: z.string().url().max(500).optional(),
  })
  .refine((d) => d.startDate <= d.endDate, {
    message: '開始日は終了日以前である必要があります',
  })

export const updateExternalFactorSchema = z.object({
  category: factorCategorySchema.optional(),
  timeAxis: factorTimeAxisSchema.optional(),
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(1000).optional(),
  impactScore: z.number().min(-1).max(1).optional(),
  area: z.string().max(50).optional(),
  sourceUrl: z.string().url().max(500).optional(),
})

// ======================================
// Type Exports
// ======================================

export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
export type CreateHotelInput = z.infer<typeof createHotelSchema>
export type CreatePriceRankInput = z.infer<typeof createPriceRankSchema>
export type UpdatePriceRankInput = z.infer<typeof updatePriceRankSchema>
export type PriceRanksQueryInput = z.infer<typeof priceRanksQuerySchema>
export type BulkUpsertPriceRanksInput = z.infer<typeof bulkUpsertPriceRanksSchema>
export type CreateSpecialDayInput = z.infer<typeof createSpecialDaySchema>
export type UpdateSpecialDayInput = z.infer<typeof updateSpecialDaySchema>
export type SpecialDaysQueryInput = z.infer<typeof specialDaysQuerySchema>
export type CreateExternalFactorInput = z.infer<typeof createExternalFactorSchema>
export type UpdateExternalFactorInput = z.infer<typeof updateExternalFactorSchema>
export type ExternalFactorsQueryInput = z.infer<typeof externalFactorsQuerySchema>
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
export type IngestNightRow = z.infer<typeof ingestNightRowSchema>
export type IngestNightsInput = z.infer<typeof ingestNightsSchema>
export type IngestReservationRow = z.infer<typeof ingestReservationRowSchema>
export type IngestReservationsInput = z.infer<typeof ingestReservationsSchema>
export type IngestInventoryInput = z.infer<typeof ingestInventorySchema>
export type FileIngestInput = z.infer<typeof fileIngestSchema>
export type UpsertIngestSchedulesInput = z.infer<typeof upsertIngestSchedulesSchema>
export type RunIngestInput = z.infer<typeof runIngestSchema>
export type UpsertSegmentsInput = z.infer<typeof upsertSegmentsSchema>
export type CancellationQueryInput = z.infer<typeof cancellationQuerySchema>
export type SegmentAxis = z.infer<typeof segmentAxisSchema>
export type SegmentAnalysisQueryInput = z.infer<typeof segmentAnalysisQuerySchema>
export type RankingQueryInput = z.infer<typeof rankingQuerySchema>
export type OnHandCurveQueryInput = z.infer<typeof onHandCurveQuerySchema>
export type InventoryQueryInput = z.infer<typeof inventoryQuerySchema>
