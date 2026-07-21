// ======================================
// Common types shared between frontend and backend
// ======================================

// ======================================
// Authentication Types
// ======================================

// 要件定義書 §4: ADMIN=システム提供側 / MANAGER=支配人 / OPERATOR=現場フロント
export type UserRole = 'ADMIN' | 'MANAGER' | 'OPERATOR'

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
  /** 週末定義（チェックイン日基準の曜日番号、0=日曜）。デフォルト [5, 6] = 金・土 */
  weekendDays?: unknown
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

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

export type Tab = 'dashboard' | 'pricing' | 'daily' | 'analysis' | 'reports' | 'settings' | 'ai-summary'

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
