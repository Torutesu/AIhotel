import { z } from 'zod'
import { dateOnly, todayJst } from './date.js'

// ======================================
// Common Validators
// ======================================

// エンティティID。cuid形式に固定しない（seedの固定ID 'demo-hotel-001' や、
// 将来DB/BaaS変更でID形式が変わる場合に備え、不透明な文字列として扱う）
/**
 * 日付だけの値（"YYYY-MM-DD"）。UTC 0時の Date にして @db.Date と比較する（#90）。
 * dateOnlyInputSchema は "2026-09-23T00:00:00+09:00" のような時刻付きの値を UTC の前日 15時に
 * してしまい、@db.Date との等価比較が0件になっていた。時刻付きの値は受け付けない
 */
export const dateOnlyInputSchema = z
  .string({ invalid_type_error: '日付は YYYY-MM-DD 形式で指定してください' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日付は YYYY-MM-DD 形式で指定してください')
  .transform((value, ctx) => {
    const date = new Date(`${value}T00:00:00Z`)
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '存在しない日付です' })
      return z.NEVER
    }
    return date
  })

/** 1回の参照で指定できる期間の上限（日）。数年分を1リクエストで返させない（#90） */
export const MAX_QUERY_RANGE_DAYS = 366

/** 開始日〜終了日が上限の日数以内か */
function withinMaxRange(start: Date, end: Date): boolean {
  return (end.getTime() - start.getTime()) / 86_400_000 < MAX_QUERY_RANGE_DAYS
}

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

/** パスワードの強度（登録・変更で共通 — #89） */
export const passwordSchema = z
  .string()
  .min(8, 'パスワードは8文字以上である必要があります')
  .max(128, 'パスワードは128文字以内で入力してください')
  .regex(/[A-Z]/, '大文字を含める必要があります')
  .regex(/[a-z]/, '小文字を含める必要があります')
  .regex(/[0-9]/, '数字を含める必要があります')

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, '現在のパスワードを入力してください'),
    newPassword: passwordSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    path: ['newPassword'],
    message: '現在と同じパスワードは使えません',
  })

/**
 * 最初の運営（PLATFORM_ADMIN）を作るジョブの入力（R-2-5 — `job create-platform-admin`）。
 * 運営を作れるのは運営だけなので、本番に最初の1人を置く手段がこのジョブしか無い
 */
export const createPlatformAdminSchema = z.object({
  email: z
    .string({ required_error: 'メールアドレスは必須です' })
    .trim()
    .toLowerCase()
    .email('有効なメールアドレスを入力してください'),
  name: z.string({ required_error: '名前は必須です' }).trim().min(1, '名前は必須です').max(100),
})

export type CreatePlatformAdminInput = z.infer<typeof createPlatformAdminSchema>

export const registerSchema = z.object({
  // メールアドレスは大文字小文字を区別しない（#44）。検索も登録も小文字で行う
  email: z.string().trim().toLowerCase().email('有効なメールアドレスを入力してください'),
  // 省略すると招待として扱う: 一時パスワードを発行し、次回ログイン時に変更を強制する（#89）。
  // メール送信が有効なら本人にメールで届け、無効なら作成者に画面で1回だけ見せる
  password: passwordSchema.optional(),
  name: z.string().min(1, '名前は必須です').max(100),
  // 運営（PLATFORM_ADMIN）を付与できるのは運営だけ。authService.registerService が検証する（#62）
  role: z.enum(['PLATFORM_ADMIN', 'ADMIN', 'MANAGER', 'OPERATOR']).optional(),
  hotelId: entityIdSchema.optional(),
  // 所属テナントの直接指定は運営だけ（まだホテルの無い新規テナントに最初の ADMIN を作るため — #81）。
  // テナント側のロールが送ると registerService が 403 にする
  tenantId: entityIdSchema.optional(),
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
// ホテルタイプ（#13）。表示名は frontend の HOTEL_TYPE_LABELS
export const hotelTypeSchema = z.enum(['FULL_SERVICE', 'LIMITED_SERVICE', 'RESORT', 'RYOKAN'])

const hotelBaseSchema = z.object({
  tenantId: entityIdSchema.optional(),
  name: z.string().min(1, 'ホテル名は必須です').max(200),
  address: z.string().max(500).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().optional(),
  totalRooms: z.number().int().min(1, '部屋数は1以上である必要があります'),
  // ホテルタイプとマーケット（#13）。未設定でも作成はできるが、初期設定のチェックリストで必須項目として扱う
  hotelType: hotelTypeSchema.nullable().optional(),
  prefectureCode: z
    .string()
    .regex(/^(0[1-9]|[1-3][0-9]|4[0-7])$/, '都道府県コードは 01〜47 で指定してください')
    .nullable()
    .optional(),
  // 全国地方公共団体コード（6桁、検査数字付き）。先頭2桁は都道府県コード
  municipalityCode: z.string().regex(/^\d{6}$/, '市区町村コードは6桁の数字で指定してください').nullable().optional(),
  marketArea: z.string().max(100).nullable().optional(),
})

const municipalityMatchesPrefecture = (data: { prefectureCode?: string | null; municipalityCode?: string | null }) =>
  !data.municipalityCode || !data.prefectureCode || data.municipalityCode.startsWith(data.prefectureCode)
const municipalityMismatch = {
  message: '市区町村コードの先頭2桁が都道府県コードと一致しません',
  path: ['municipalityCode'],
}

export const createHotelSchema = hotelBaseSchema.refine(municipalityMatchesPrefecture, municipalityMismatch)

export const updateHotelSchema = hotelBaseSchema
  .omit({ tenantId: true })
  .partial()
  .refine(municipalityMatchesPrefecture, municipalityMismatch)

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
  startDate: dateOnlyInputSchema,
  endDate: dateOnlyInputSchema,
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
  startDate: dateOnlyInputSchema.optional(),
  endDate: dateOnlyInputSchema.optional(),
}).refine(
  (data) => !data.startDate || !data.endDate || data.startDate <= data.endDate,
  { message: '開始日は終了日以前である必要があります' }
).refine(
  (data) => !data.startDate || !data.endDate || withinMaxRange(data.startDate, data.endDate),
  { message: `期間は${MAX_QUERY_RANGE_DAYS}日以内で指定してください` }
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
  // ホテルタイプとマーケット（#13）
  hotelType: hotelBaseSchema.shape.hotelType,
  prefectureCode: hotelBaseSchema.shape.prefectureCode,
  municipalityCode: hotelBaseSchema.shape.municipalityCode,
  marketArea: hotelBaseSchema.shape.marketArea,
}).refine(municipalityMatchesPrefecture, municipalityMismatch)

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
  // 2026-08-01 クライアントMTGで取得対象に確定したもの（#9）
  booking: otaUrlValue,
  tripcom: otaUrlValue,
  official: otaUrlValue,
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
// Audit Log Validators（#89）
// ======================================

export const auditLogQuerySchema = z
  .object({
    hotelId: entityIdSchema,
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '開始日は YYYY-MM-DD 形式で指定してください').optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '終了日は YYYY-MM-DD 形式で指定してください').optional(),
    action: z.string().regex(/^[A-Z_]{1,40}$/, '操作の種類が正しくありません').optional(),
    // 前のページの最後の行の id（カーソル方式のページネーション）
    cursor: entityIdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { path: ['from'], message: '開始日は終了日以前にしてください' })

// ======================================
// Import Validators（#82）
// ======================================

/** 1回の取り込みで受け付ける最大行数（1年分＋余裕。リクエストは express.json の 1mb にも収まる） */
export const MAX_IMPORT_ROWS = 1000

/** "YYYY-MM-DD"。暦に存在しない日付（2026-02-30 など）は弾く */
const importDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日付は YYYY-MM-DD 形式で入力してください')
  .refine((value) => {
    const d = new Date(`${value}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
  }, '存在しない日付です')

export const importDailyDataSchema = z.object({
  hotelId: entityIdSchema,
  // true なら検証と件数の集計だけを行い、書き込まない
  dryRun: z.boolean().optional(),
  rows: z
    .array(
      z.object({
        date: importDateSchema,
        soldRooms: z.number({ invalid_type_error: '販売室数は数値で入力してください' }).int('販売室数は整数で入力してください').min(0, '販売室数は0以上で入力してください'),
        totalRevenue: z.number({ invalid_type_error: '室料売上は数値で入力してください' }).min(0, '室料売上は0以上で入力してください'),
        guests: z.number().int('宿泊人数は整数で入力してください').min(0, '宿泊人数は0以上で入力してください').nullable().optional(),
      })
    )
    .min(1, '取り込む行がありません')
    .max(MAX_IMPORT_ROWS, `1回に取り込めるのは${MAX_IMPORT_ROWS}行までです`),
})

/** 競合価格の取り込みの最大行数。競合5社×90日×取得元8つを1回で入れられる（#9） */
export const MAX_COMPETITOR_IMPORT_ROWS = 5000

/** 競合価格の取得元（#9）。otaUrlsSchema のキーに、手入力・CSV を足したもの */
export const competitorPriceSourceSchema = z.enum([
  'rakuten', 'jalan', 'ikkyu', 'expedia', 'agoda', 'booking', 'tripcom', 'official', 'manual',
])

const importPriceSchema = z
  .number({ invalid_type_error: '料金は数値で入力してください' })
  .int('料金は整数（円）で入力してください')
  .min(1, '料金は1円以上で入力してください')
  .max(10_000_000, '料金が大きすぎます')
  .nullable()
  .optional()

// 競合価格の取り込み（#9 の段階A）。自前の取得（クローラ）もこの形で書き込む
export const importCompetitorPricesSchema = z.object({
  hotelId: entityIdSchema,
  dryRun: z.boolean().optional(),
  rows: z
    .array(
      z.object({
        // 設定タブで登録した競合ホテル名と完全一致させる
        competitorName: z.string().trim().min(1, '競合ホテル名は必須です').max(200),
        date: importDateSchema,
        price1P: importPriceSchema,
        price2P: importPriceSchema,
        price3P: importPriceSchema,
        // 満室・販売停止。true の行は料金を空にする
        soldOut: z.boolean().optional(),
        source: competitorPriceSourceSchema.optional(),
        // 取得日時（ISO 8601）。省略時は取り込んだ時刻
        observedAt: z.string().datetime({ offset: true, message: '取得日時は ISO 8601 形式で入力してください' }).optional(),
      })
    )
    .min(1, '取り込む行がありません')
    .max(MAX_COMPETITOR_IMPORT_ROWS, `1回に取り込めるのは${MAX_COMPETITOR_IMPORT_ROWS}行までです`),
})

// OTB（その時点の予約積上室数）の取り込み（#24 E2）。後から作れないデータなので、毎日1回入れる
export const importOtbSchema = z.object({
  hotelId: entityIdSchema,
  dryRun: z.boolean().optional(),
  // いつ時点の予約数か。省略時は今日（JST）
  capturedDate: importDateSchema.optional(),
  rows: z
    .array(
      z.object({
        stayDate: importDateSchema,
        roomsBooked: z
          .number({ invalid_type_error: '予約室数は数値で入力してください' })
          .int('予約室数は整数で入力してください')
          .min(0, '予約室数は0以上で入力してください'),
      })
    )
    .min(1, '取り込む行がありません')
    .max(MAX_IMPORT_ROWS, `1回に取り込めるのは${MAX_IMPORT_ROWS}行までです`),
})

// ======================================
// 初期設定を速くする仕組み（#13）
// ======================================

export const integrationKindSchema = z.enum(['PMS', 'SITE_CONTROLLER'])

export const upsertIntegrationSchema = z.object({
  hotelId: entityIdSchema,
  kind: integrationKindSchema,
  product: z.string().trim().min(1, '製品名は必須です').max(100),
  connectionMethod: z.string().trim().max(200).nullable().optional(),
  status: z.enum(['PLANNED', 'TESTING', 'ACTIVE']),
  note: z.string().trim().max(1000).nullable().optional(),
})

export const integrationKindParamSchema = z.object({ kind: integrationKindSchema })

export const copyHotelSettingsSchema = z.object({
  hotelId: entityIdSchema,
  sourceHotelId: entityIdSchema,
  items: z
    .array(z.enum(['roomTypes', 'priceRanks', 'strategy']))
    .min(1, '複製する項目を選んでください')
    .refine((items) => new Set(items).size === items.length, '同じ項目が重複しています'),
})

// 初期設定シート（Excel）の取り込み（#13）。ファイルは base64 で受け取る（express.json の 1mb に収まる大きさ）
export const importSetupWorkbookSchema = z.object({
  dryRun: z.boolean().optional(),
  fileBase64: z
    .string()
    .min(1, 'ファイルが空です')
    .max(900_000, 'ファイルが大きすぎます（約650KBまで）')
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'ファイルの形式が正しくありません'),
})

// ======================================
// Platform（運営）Validators（#81）
// ======================================

export const createTenantSchema = z.object({
  name: z.string().trim().min(1, 'テナント名は必須です').max(200),
  // URL やログに出す識別子。小文字英数字とハイフン
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/, 'コードは小文字英数字とハイフンの3〜50文字で入力してください'),
})

export const updateTenantSchema = z
  .object({
    name: z.string().trim().min(1, 'テナント名は必須です').max(200).optional(),
    // false で契約停止。所属ユーザーは次のリクエストから 401 になる（#78）
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: '更新する項目を指定してください' })

// ======================================
// Room Type Validators（#81）
// ======================================

export const createRoomTypeSchema = z.object({
  hotelId: entityIdSchema,
  name: z.string().trim().min(1, '部屋タイプ名は必須です').max(100),
  // PMS の部屋タイプコードと突き合わせるための識別子。大文字小文字は区別しない（保存時に大文字へ揃える）
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,30}$/, 'コードは英数字・ハイフン・アンダースコアの30文字以内で入力してください')
    .transform((v) => v.toUpperCase()),
  capacity: z.number().int().min(1, '定員は1以上である必要があります').max(20),
  count: z.number().int().min(1, '室数は1以上である必要があります').max(10000),
  sortOrder: z.number().int().min(0).max(1000).optional(),
})

export const updateRoomTypeSchema = createRoomTypeSchema
  .omit({ hotelId: true })
  .partial()
  .refine((data) => Object.keys(data).length > 0, { message: '更新する項目を指定してください' })

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
  baseDate: dateOnlyInputSchema.optional(),
})

export const aiSummaryQuerySchema = z.object({
  hotelId: entityIdSchema,
  section: z.string().max(50).optional(),
})

export const bookingCurveQuerySchema = z.object({
  hotelId: entityIdSchema,
  date: dateOnlyInputSchema,
})

export const competitorPricesQuerySchema = z.object({
  hotelId: entityIdSchema,
  startDate: dateOnlyInputSchema,
  endDate: dateOnlyInputSchema,
}).refine(data => data.startDate <= data.endDate, {
  message: '開始日は終了日以前である必要があります',
}).refine(data => withinMaxRange(data.startDate, data.endDate), {
  message: `期間は${MAX_QUERY_RANGE_DAYS}日以内で指定してください`,
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
  startDate: dateOnlyInputSchema.optional(),
  endDate: dateOnlyInputSchema.optional(),
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
const rankBoundSchema = z.number().int().min(1).max(40)

export const updateStrategySchema = z.object({
  hotelId: entityIdSchema,
  // 重みは3つ揃えて送るか、まったく送らない（推奨の調整だけを保存する場合 — #17）
  weightOccupancy: z.number().int().min(0).max(100).optional(),
  weightAdr: z.number().int().min(0).max(100).optional(),
  weightCompetitor: z.number().int().min(0).max(100).optional(),
  // 推奨ランクの調整（#17）。省略した項目は変更しない
  competitorOccupancy: z.union([z.literal(1), z.literal(2)]).nullable().optional(),
  competitorOffsetPct: z.number().int().min(-30, '競合との価格差は-30%以上で指定してください').max(30, '競合との価格差は+30%以下で指定してください').optional(),
  minRank: rankBoundSchema.nullable().optional(),
  maxRank: rankBoundSchema.nullable().optional(),
  maxDailyRankChange: z.number().int().min(1).max(40).nullable().optional(),
  hysteresisRanks: z.number().int().min(0).max(5).optional(),
}).refine(data => {
  const weights = [data.weightOccupancy, data.weightAdr, data.weightCompetitor]
  if (weights.every((w) => w === undefined)) return true
  return weights.every((w) => w !== undefined) && weights.reduce<number>((sum, w) => sum + (w ?? 0), 0) === 100
}, {
  message: '重み付けの合計は100%である必要があります',
}).refine(data => data.minRank == null || data.maxRank == null || data.minRank <= data.maxRank, {
  message: '推奨ランクの下限は上限以下にしてください',
  path: ['minRank'],
})

// 推奨を固定する期間（#17 のガードレール③）
export const createPricingLockSchema = z.object({
  hotelId: entityIdSchema,
  startDate: dateOnlyInputSchema,
  endDate: dateOnlyInputSchema,
  reason: z.string().max(200).optional(),
}).refine(data => data.startDate <= data.endDate, {
  message: '開始日は終了日以前である必要があります',
}).refine(data => withinMaxRange(data.startDate, data.endDate), {
  message: `期間は${MAX_QUERY_RANGE_DAYS}日以内で指定してください`,
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
export type UpdateStrategyInput = z.infer<typeof updateStrategySchema>
export type CreatePricingLockInput = z.infer<typeof createPricingLockSchema>
export type CreateCompetitorInput = z.infer<typeof createCompetitorSchema>
export type UpdateCompetitorInput = z.infer<typeof updateCompetitorSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>
export type ImportDailyDataInput = z.infer<typeof importDailyDataSchema>
export type ImportCompetitorPricesInput = z.infer<typeof importCompetitorPricesSchema>
export type ImportOtbInput = z.infer<typeof importOtbSchema>
export type UpsertIntegrationInput = z.infer<typeof upsertIntegrationSchema>
export type CopyHotelSettingsInput = z.infer<typeof copyHotelSettingsSchema>
export type ImportSetupWorkbookInput = z.infer<typeof importSetupWorkbookSchema>
export type CreateTenantInput = z.infer<typeof createTenantSchema>
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>
export type CreateRoomTypeInput = z.infer<typeof createRoomTypeSchema>
export type UpdateRoomTypeInput = z.infer<typeof updateRoomTypeSchema>
export type UpdateUserInput = z.infer<typeof updateUserSchema>
export type UpdateAlertStatusInput = z.infer<typeof updateAlertStatusSchema>
export type MonthTargetInput = z.infer<typeof monthTargetSchema>
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>
