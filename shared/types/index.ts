// ======================================
// Common types shared between frontend and backend
// ======================================

// ======================================
// Authentication Types
// ======================================

// 要件定義書 §4: ADMIN=システム提供側 / MANAGER=支配人 / OPERATOR=現場フロント
/**
 * ロール（要件定義書 §5 / #62）。
 * - PLATFORM_ADMIN（運営）: サービス提供側。tenantId は null。テナントを越えられる唯一のロール
 * - ADMIN（管理者）: テナント管理者。自テナント内で最上位。他テナントには一切アクセスできない
 * - MANAGER（マネージャー）: 支配人・レベニューマネージャー
 * - OPERATOR（オペレーター）: 現場フロント担当
 *
 * 画面表示名は ROLE_LABELS（同ファイル）を唯一の出所とする。
 */
export type UserRole = 'PLATFORM_ADMIN' | 'ADMIN' | 'MANAGER' | 'OPERATOR'

/** ロールの日本語表示名（UI でロールを描画するときは必ずこれを使う — #62） */
export const ROLE_LABELS: Record<UserRole, string> = {
  PLATFORM_ADMIN: '運営',
  ADMIN: '管理者',
  MANAGER: 'マネージャー',
  OPERATOR: 'オペレーター',
}

/** 表示・選択肢の並び順（上位ロールから） */
export const ROLE_ORDER: readonly UserRole[] = ['PLATFORM_ADMIN', 'ADMIN', 'MANAGER', 'OPERATOR']

/**
 * 設定変更・更新系を実行できるロール。
 * バックエンドの `requireRole('ADMIN', 'MANAGER')` ＋ PLATFORM_ADMIN（全ロールの上位集合）
 * と同じ判定を返す。UI で「403 になる操作を出さない／通る操作を隠さない」ために使う。
 */
export function canManage(role: UserRole | null | undefined): boolean {
  return role === 'PLATFORM_ADMIN' || role === 'ADMIN' || role === 'MANAGER'
}

export interface User {
  id: string
  tenantId: string | null
  email: string
  name: string
  role: UserRole
  hotelId: string | null
  isActive: boolean
  lastLoginAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface Tenant {
  id: string
  name: string
  code: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

export interface LoginResponse {
  user: Omit<User, 'password'>
  tokens: AuthTokens
}

// ======================================
// Hotel & Room Types
// ======================================

export interface Hotel {
  id: string
  tenantId: string
  name: string
  address: string | null
  phone: string | null
  email: string | null
  totalRooms: number
  /**
   * 週末定義（チェックイン日基準の曜日番号、0=日曜）。デフォルト [5, 6] = 金・土。
   * DB では Json 列のため行の型としては `unknown` のままにしている。
   * APIレスポンス／フロントエンドで扱う際は必ず {@link HotelDto}（`number[]` 確定）を使う。
   */
  weekendDays: unknown
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

/**
 * APIレスポンスとしてのホテル。`weekendDays` は `number[]`（0=日〜6=土）で確定する。
 * フロントエンドはこの型を使い、`as number[]` のキャストを行わない。
 */
export type HotelDto = Omit<Hotel, 'weekendDays'> & { weekendDays: number[] }

export interface RoomType {
  id: string
  hotelId: string
  name: string
  code: string
  capacity: number
  count: number
  isActive: boolean
  sortOrder: number
}

// ======================================
// Pricing Types
// ======================================

export interface PriceRank {
  id: string
  hotelId: string
  rank: number
  label: string
  price1P: number
  price2P: number
  price3P?: number
  price4P?: number
  isActive: boolean
}

export interface PriceData {
  date: Date
  roomTypeId: string
  price1P?: number
  price2P?: number
  price3P?: number
  occupancy?: number
}

export interface PricingStrategy {
  id: string
  name: string
  type: 'balanced' | 'aggressive' | 'conservative'
}

export type DemandLevel = 'A' | 'B' | 'C' | 'D' | 'E'

// ======================================
// Daily Data Types
// ======================================

export interface DailyData {
  id: string
  hotelId: string
  date: Date
  
  // 実績データ
  occupancy?: number
  adr?: number
  revPar?: number
  totalRevenue?: number
  soldRooms?: number
  guests?: number
  
  // 予算データ
  budgetOccupancy?: number
  budgetAdr?: number
  budgetRevenue?: number
  
  // AI予測データ
  aiPredictedOccupancy?: number
  aiPredictedAdr?: number
  aiRecommendedRank?: number
  demandLevel?: DemandLevel
  
  // メタデータ
  isHoliday: boolean
  holidayName?: string
  eventInfo?: string
  externalFactors?: string
  notes?: string
}

export interface DailyRoomData {
  id: string
  dailyDataId: string
  roomTypeId: string
  priceRank?: number
  price1P?: number
  price2P?: number
  price3P?: number
  soldRooms?: number
  revenue?: number
}

// ======================================
// KPI Types
// ======================================

export interface KPIData {
  label: string
  baseValue: number
  unit?: string
  isPercentage?: boolean
  budgetRatio: number
  budgetComparison: number
  lastYearRatio: number
  lastYearComparison: number
  aiPredictionValue: number
}

export interface KPISummary {
  roomRevenue: number
  soldRooms: number
  adr: number
  occupancyRate: number
  revPar: number
  guests: number
  dor: number
  guestUnitPrice: number
}

// ======================================
// Campaign Types
// ======================================

export interface Campaign {
  id: string
  hotelId: string
  name: string
  channel: string
  source: 'ota' | 'manual'
  startDate: Date
  endDate: Date
  description?: string
  targetRooms?: number
  actualRooms?: number
  adrImpact?: number
  revParImpact?: number
  isActive: boolean
}

// Legacy support
export interface CampaignData {
  id: string
  campaignName: string
  channel: string
  startDate: Date | null
  endDate: Date | null
  source: 'ota' | 'manual'
  rooms: number
  adrImpact: number
  revParImpact: number
  description: string
}

// ======================================
// Competitor Types
// ======================================

export interface Competitor {
  id: string
  hotelId: string
  name: string
  address?: string
  category?: string
  isActive: boolean
}

export interface CompetitorPriceData {
  date: string
  competitorAveragePrice: number
  ourPrice: number
  priceDifference: number
  priceDifferencePercent: number
  dataSource: string
  dataTimestamp: Date
  sampleSize?: number
  reliability?: 'high' | 'medium' | 'low'
}

export interface CompetitorComparisonData {
  period: string
  ourAveragePrice: number
  competitorAveragePrice: number
  priceDifference: number
  priceDifferencePercent: number
  marketPosition: 'high' | 'medium' | 'low'
  competitivenessScore: number
  dataSource: string
  dataTimestamp: Date
  sampleSize?: number
}

export interface CompetitorDayOfWeekData {
  dayOfWeek: string
  ourPrice: number
  competitorAveragePrice: number
  priceDifference: number
  priceDifferencePercent: number
}

// ======================================
// Event Types
// ======================================

export interface Event {
  id: string
  hotelId: string
  name: string
  type: string
  startDate: Date
  endDate: Date
  location?: string
  expectedImpact?: 'high' | 'medium' | 'low'
  description?: string
}

// ======================================
// Analysis Types
// ======================================

export type AnalysisType = 'channel' | 'region' | 'group' | 'cancel' | 'other'
export type DisplayMode = 'table' | 'graph'
export type GraphType = 'total' | 'daily'

export interface AnalysisSettings {
  key: string
  selection: string
  showRooms: boolean
  showGuests: boolean
  showADR: boolean
  showReservations: boolean
  individualGroupTotal: 'individual' | 'group' | 'total'
  includeRoomType?: boolean
}

export interface SegmentCrossAnalysisSettings {
  dateFrom: Date
  dateTo: Date
  displayMode: DisplayMode
  graphType: GraphType
  channelAnalysis: AnalysisSettings
  regionAnalysis: AnalysisSettings
  groupAnalysis: AnalysisSettings
  cancelAnalysis: AnalysisSettings
  otherAnalysis: AnalysisSettings
  reservationTypeView: 'reservation' | 'group'
  includeBatch: boolean
}

// ======================================
// Chat Types
// ======================================

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

// ======================================
// Navigation Types
// ======================================

export type Tab = 'dashboard' | 'pricing' | 'analysis' | 'reports' | 'settings' | 'ai-summary'

// ======================================
// API Response Types
// ======================================

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  message?: string
  errors?: Array<{ field: string; message: string }>
  meta?: PaginationMeta
}

export interface PaginationMeta {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  meta: PaginationMeta
}

// ======================================
// Request Types
// ======================================

export interface PaginationParams {
  page?: number
  limit?: number
}

export interface DateRangeParams {
  startDate: Date | string
  endDate: Date | string
}

export interface HotelQueryParams extends PaginationParams {
  hotelId: string
}

// ======================================
// External Factors Types (for AI Summary)
// ======================================

export interface ExternalFactorCategory {
  name: string
  factors: ExternalFactor[]
}

export interface ExternalFactor {
  name: string
  status: 'positive' | 'warning' | 'normal'
  trend: 'up' | 'down' | 'neutral'
  note: string
}

export interface SeasonalEvent {
  id: string
  name: string
  period: string
  impact: '特高' | '高' | '中' | '低'
  type: 'inbound' | 'domestic' | 'both' | 'climate'
  description: string
}

export interface MonthlyForecast {
  month: string
  demandIndex: number
  climate: number
  inbound: number
  events: number
  access: number
  label: string
}

// ======================================
// Monthly Budget Types（N-1 / F-SET-04）
// ======================================

/** 月次予算。稼働率は 0〜1 の比率（実績側の occupancyRate と同じスケール） */
export interface MonthlyBudget {
  id: string
  tenantId: string
  hotelId: string
  year: number
  month: number
  budgetRevenue: number | null
  budgetRooms: number | null
  budgetAdr: number | null
  budgetOccupancy: number | null
  budgetGuests: number | null
  lastYearRevenue: number | null
  lastYearRooms: number | null
  lastYearAdr: number | null
  lastYearOccupancy: number | null
  lastYearGuests: number | null
  createdAt: Date
  updatedAt: Date
}

/** GET/PUT /settings/budgets のレスポンス。未登録の月も budget: null で必ず含まれる */
export interface BudgetYear {
  hotelId: string
  year: number
  months: Array<{
    month: number
    budget: MonthlyBudget | null
  }>
}

/** PUT /settings/budgets のリクエストボディ。送った月だけが upsert される */
export interface UpsertBudgetsRequest {
  hotelId: string
  year: number
  months: Array<{
    month: number
    budgetRevenue?: number | null
    budgetRooms?: number | null
    budgetAdr?: number | null
    budgetOccupancy?: number | null
    budgetGuests?: number | null
    lastYearRevenue?: number | null
    lastYearRooms?: number | null
    lastYearAdr?: number | null
    lastYearOccupancy?: number | null
    lastYearGuests?: number | null
  }>
}

// ======================================
// Competitor Settings Types（N-2 / F-SET-03）
// ======================================

/** 競合ホテルの OTA 別 URL。キーは対応OTAに固定する（F-SET-03） */
export interface CompetitorOtaUrls {
  rakuten?: string | null
  jalan?: string | null
  ikkyu?: string | null
  expedia?: string | null
  agoda?: string | null
}

/** GET/POST/PUT /settings/competitors が返す競合ホテル（論理削除済みは返らない） */
export interface CompetitorSetting {
  id: string
  tenantId: string
  hotelId: string
  name: string
  address: string | null
  category: string | null
  otaUrls: CompetitorOtaUrls | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

/** 1ホテルあたりに登録できる競合ホテルの上限（F-SET-03） */
export const MAX_COMPETITORS_PER_HOTEL = 5

// ======================================
// User Management Types（N-3）
// ======================================

/** PUT /users/:id のリクエストボディ。省略した項目は変更しない */
export interface UpdateUserRequest {
  name?: string
  role?: UserRole
  isActive?: boolean
}

/**
 * POST /auth/register のリクエストボディ。
 * tenantId は受け取らず、常に hotelId の所属テナントから導出される。
 * MANAGER が呼ぶ場合は hotelId 必須・自テナント内・role は ADMIN 以外に限る。
 */
export interface RegisterUserRequest {
  email: string
  password: string
  name: string
  role?: UserRole
  hotelId?: string
}

// ======================================
// Alert Status Types（N-4）
// ======================================

export type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'

/**
 * PATCH /dashboard/alerts/:id のリクエストボディ。
 * ACKNOWLEDGED は OPERATOR も実行できるが、RESOLVED は MANAGER 以上に限る。
 */
export interface UpdateAlertStatusRequest {
  hotelId: string
  status: Extract<AlertStatus, 'ACKNOWLEDGED' | 'RESOLVED'>
}

// ======================================
// KPI Snapshot / Landing Simulation Types（N-5）
// ======================================

/** POST /dashboard/kpi/snapshot・POST /pricing/simulation/recompute のリクエストボディ */
export interface MonthTargetRequest {
  hotelId: string
  year: number
  month: number
}

/** 当日時点のKPIスナップショット（月初比較・日付比較の比較元 — F-DASH-04） */
export interface KpiSnapshot {
  id: string
  tenantId: string
  hotelId: string
  /** スナップショット取得日（YYYY-MM-DD） */
  snapshotDate: string
  targetYear: number
  targetMonth: number
  revenue: number | null
  soldRooms: number | null
  adr: number | null
  occupancy: number | null
  revPar: number | null
  guests: number | null
  createdAt: Date
}

/** 月間着地シミュレーション（F-DP-04） */
export interface MonthlyLandingSimulation {
  id: string
  tenantId: string
  hotelId: string
  year: number
  month: number
  projectedRevenue: number | null
  projectedAdr: number | null
  projectedOccupancy: number | null
  projectedRevPar: number | null
  projectedRooms: number | null
  computedAt: Date
}

/** POST /pricing/simulation/recompute のレスポンス */
export interface RecomputeSimulationResponse {
  simulation: MonthlyLandingSimulation
  /** 実績で積み上げた日数 */
  actualDays: number
  /** AI予測で積み上げた日数 */
  predictedDays: number
}

// ======================================
// Review Score Types（N-7 / F-ANA-04）
// ======================================

/**
 * OTA・レビューサイトごとの口コミ評価点（GET /analysis/reviews）。
 * 実運用では Phase 4 のスクレイピングが書き込む想定のテーブルで、
 * 現在は seed データが入っている（値そのものは実APIの応答）。
 */
export interface ReviewScore {
  id: string
  tenantId: string
  hotelId: string
  /** 取得元（rakuten / jalan / ikkyu / google / tripadvisor 等） */
  source: string
  /** 評価点（5点満点） */
  score: number
  /** 口コミ件数（取得できない場合は null） */
  reviewCount: number | null
  /** 取得日時（ISO 8601 文字列） */
  capturedAt: string
}
