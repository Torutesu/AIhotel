// バックエンドの API レスポンス・リクエストの型（#91 で lib/api.ts から分割）。
// 画面は @/lib/api から import する（このファイルを直接参照しない）。

import type {
  User,
  CompetitorOtaUrls,
} from "@shared/types"

// ---- Response types (backend契約) ----

export interface LoginResult {
  user: User
  tokens: { accessToken: string; refreshToken: string }
}

/** 1軸ぶんの比較結果（F-DASH-02）。比率は実績÷目標、目標未設定なら null */
export interface ComparisonAxis {
  budgetRevenue: number | null
  budgetRevenueRatio: number | null
  budgetAdr: number | null
  budgetAdrRatio: number | null
  budgetOccupancy: number | null
  budgetOccupancyRatio: number | null
  lastYearRevenue: number | null
  lastYearRevenueRatio: number | null
  lastYearAdr: number | null
  lastYearAdrRatio: number | null
  lastYearOccupancy: number | null
  lastYearOccupancyRatio: number | null
}

/** KPI進捗表に出す実績サマリー（F-DASH-01 の8指標＋集計日数） */
export interface ActualSummary {
  roomRevenue: number
  soldRooms: number
  adr: number
  occupancyRate: number
  revPar: number
  guests: number
  dor: number
  guestUnitPrice: number
  actualDays: number
}

export interface DashboardKpi {
  hotelId: string
  year: number
  month: number
  summary: ActualSummary
  comparison: {
    budgetRevenue: number | null
    budgetRevenueToDate: number | null
    budgetRatioToDate: number | null
    budgetAdr: number | null
    budgetOccupancy: number | null
    lastYearRevenue: number | null
    lastYearRatio: number | null
    lastYearAdr: number | null
    lastYearOccupancy: number | null
    /** 本日まで（経過日数按分した予算との比較） */
    toDate: ComparisonAxis
    /** 累計進捗（月間予算フルに対する到達率） */
    cumulative: ComparisonAxis
    /** 年度累計（年度開始月から当月までの累計どうしの比較） */
    fiscalYear: ComparisonAxis
    fiscalYearLabel: string
    /**
     * 比較軸ごとの実績サマリー（#54）。
     * 年度累計軸でも8指標すべてが年度累計の値で揃うため、
     * 画面側で月次実績にフォールバックしてはならない。
     */
    actualSummary: {
      toDate: ActualSummary
      cumulative: ActualSummary
      fiscalYear: ActualSummary
    }
  } | null
  dailyTrend: Array<{
    date: string
    occupancy: number | null
    adr: number | null
    predictedOccupancy: number | null
    predictedAdr: number | null
    /** 前年同月同日の実績（グラフ重ね描き用 — F-DASH-03） */
    lastYearOccupancy: number | null
    lastYearAdr: number | null
    isActual: boolean
  }>
  simulation: {
    projectedRevenue: number | null
    projectedAdr: number | null
    projectedOccupancy: number | null
    projectedRevPar: number | null
  } | null
}

/**
 * KPIスナップショット（F-DASH-04）。日次バッチで取得した「その時点の当月見込み」。
 * スナップショットが未取得の月は空配列が返る（画面側で値を捏造しないこと）。
 */
export interface KpiSnapshot {
  id: string
  hotelId: string
  /** 取得日（ISO日付文字列） */
  snapshotDate: string
  targetYear: number
  targetMonth: number
  revenue: number | null
  soldRooms: number | null
  adr: number | null
  occupancy: number | null
  revPar: number | null
  guests: number | null
}

export interface AlertItem {
  id: string
  severity: "RED" | "YELLOW"
  /** 重要度 1-5（5が最重要）。ダッシュボードは5・4のみ表示（F-DASH-05） */
  level: number
  title: string
  message: string
  linkTab: string | null
  targetDate: string | null
  status: string
  detectedAt: string
}

export interface AiSummary {
  id: string
  section: string
  content: string
  generatedAt: string
}

export interface PricingCalendarDay {
  date: string
  demandLevel: "A" | "B" | "C" | "D" | "E" | null
  recommendedRank: number | null
  recommendedPrice: number | null
  rankLabel: string | null
  price1P: number | null
  price2P: number | null
  price3P: number | null
  predictedOccupancy: number | null
  predictedAdr: number | null
  actualOccupancy: number | null
  actualAdr: number | null
  /** 競合価格水準の代表値。1社の極端な価格に引きずられない中央値を使う（C-9） */
  competitorMedianPrice: number | null
  competitorMinPrice: number | null
  competitorMaxPrice: number | null
  /** @deprecated `competitorMedianPrice` を使うこと（C-9）。バックエンド互換のため残置 */
  confidence: number | null
  /** 推奨理由（#24 E4）。推奨の無い日と古い推奨は null */
  rationale?: RecommendationRationale | null
}

export interface PricingCalendar {
  hotelId: string
  year: number
  month: number
  calendar: PricingCalendarDay[]
}

/** 月次着地シミュレーション（MonthlyLandingSimulation）。再計算バッチ／recompute で生成される */
export interface MonthlyLandingSimulation {
  id: string
  hotelId: string
  year: number
  month: number
  projectedRevenue: number | null
  projectedAdr: number | null
  projectedOccupancy: number | null
  projectedRevPar: number | null
  projectedRooms: number | null
  computedAt: string
}

/** 月次予算（MonthlyBudget）。未登録なら null */
export interface MonthlyBudgetRow {
  id: string
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
}

/** GET /api/v1/pricing/simulation のレスポンス */
export interface PricingSimulation {
  simulation: MonthlyLandingSimulation | null
  budget: MonthlyBudgetRow | null
}

/** POST /api/v1/pricing/recompute のレスポンス */
export interface RecomputeForecastResult {
  count: number
  modelVersion: string
  startDate: string
  endDate: string
}

/** POST /api/v1/pricing/simulation/recompute のレスポンス */
export interface RecomputeSimulationResult {
  simulation: MonthlyLandingSimulation
  actualDays: number
  predictedDays: number
}

export interface PricingStrategy {
  /** 未保存のホテルでは null（既定値の稼働率100%が返る） */
  id: string | null
  hotelId: string
  weightOccupancy: number
  weightAdr: number
  weightCompetitor: number
  /** 推奨ランクの調整（#17）。競合と比べる人数。null はホテルタイプから自動（宿泊特化=1名、それ以外=2名） */
  competitorOccupancy: 1 | 2 | null
  /** 競合の中央値に対する狙い（-30〜+30%） */
  competitorOffsetPct: number
  /** 推奨ランクの下限・上限（null は制限なし） */
  minRank: number | null
  maxRank: number | null
  /** 前回の推奨から1回の再計算で動かせるランク数（null は制限なし） */
  maxDailyRankChange: number | null
  /** 前回の推奨との差がこのランク数以内なら据え置く */
  hysteresisRanks: number
}

/** PUT /pricing/strategy に送る値。送った項目だけが変わる（重みは3つ揃えて送るか、まったく送らない） */
export type PricingStrategyInput = Partial<Omit<PricingStrategy, "id" | "hotelId">>

/** 推奨を固定する期間（#17）。期間内の日は再計算しても推奨が変わらない */
export interface PricingLockPeriod {
  id: string
  hotelId: string
  startDate: string
  endDate: string
  reason: string | null
}

/** 推奨理由（#24 E4）。バックエンドの services/forecast/rationale.ts と同じ形 */
export interface RecommendationRationale {
  version: 1
  modelVersion: string
  recommendedRank: number
  factors: Array<{
    key: "occupancy" | "adr" | "competitor"
    rank: number
    weight: number
    input: Record<string, number | string | null>
  }>
  adjustments: Array<{ key: "event" | "weekend"; impact: number }>
  excluded: Array<{ key: "occupancy" | "adr" | "competitor"; reason: "no_data" | "stale" | "zero_weight" }>
  guardrails: Array<{ key: "minRank" | "maxRank" | "maxDailyChange" | "hysteresis"; from: number; to: number }>
}

export interface BookingCurve {
  hotelId: string
  stayDate: string
  totalRooms: number
  points: Array<{ daysBefore: number; roomsBooked: number; occupancy: number }>
}

export interface CompetitorPrices {
  hotelId: string
  startDate: string
  endDate: string
  /**
   * 自館の日別価格。`price` は人数非依存の代表値（実績日はADR、未来日はAI推奨価格）、
   * `price1P`〜`price3P` は利用人数別の価格（#57）。値が無い人数は null。
   */
  ownPrices: Array<{
    date: string
    price: number | null
    isActual: boolean
    price1P: number | null
    price2P: number | null
    price3P: number | null
  }>
  competitors: Array<{
    id: string
    name: string
    category: string | null
    prices: Array<{
      date: string
      price1P: number | null
      price2P: number | null
      price3P: number | null
      reliability: string | null
    }>
  }>
}

export interface MonthlyTrend {
  hotelId: string
  year: number
  months: Array<{
    month: number
    revenue: number
    soldRooms: number
    guests: number
    adr: number | null
    occupancy: number | null
    revPar: number | null
    budgetRevenue: number | null
    lastYearRevenue: number | null
    hasActuals: boolean
  }>
}

export interface CompetitorAnalysis {
  hotelId: string
  startDate: string
  endDate: string
  competitors: Array<{
    id: string
    name: string
    category: string | null
    sampleSize: number
    minPrice: number | null
    maxPrice: number | null
    /** 競合価格水準の代表値（中央値 — C-9） */
    medianPrice: number | null
    /** @deprecated `medianPrice` を使うこと（C-9）。バックエンド互換のため残置 */
  }>
}

export interface CreateEventInput {
  hotelId: string
  name: string
  type: string
  startDate: string
  endDate: string
  location?: string
  expectedImpact?: "high" | "medium" | "low"
  description?: string
}

export type UpdateEventInput = Partial<Omit<CreateEventInput, "hotelId">>

/** POST /api/v1/settings/price-ranks のリクエスト（rank は 1〜40 — F-SET-02） */
export interface CreatePriceRankInput {
  hotelId: string
  rank: number
  label: string
  price1P: number
  price2P: number
  /** 未設定は null。省略（undefined）は更新時に「変更しない」を意味する（R-2） */
  price3P?: number | null
  price4P?: number | null
}

export interface UpdateHotelSettingsInput {
  name?: string
  address?: string
  phone?: string
  email?: string
  totalRooms?: number
  weekendDays?: number[]
}

/** POST /api/v1/settings/competitors のリクエスト（最大5件 — F-SET-03 / X-2） */
export interface CreateCompetitorInput {
  hotelId: string
  name: string
  address?: string | null
  category?: string | null
  otaUrls?: CompetitorOtaUrls | null
}

/** PUT /api/v1/settings/competitors/:id のリクエスト（hotelId はクエリで渡す） */
export type UpdateCompetitorInput = Partial<Omit<CreateCompetitorInput, "hotelId">>

/** ダッシュボードの表示設定（#51-2。サーバ保存され端末間で共有される） */
export interface DashboardPreference {
  /** 「販売サイト別実績」セクションを表示するか */
  showTopSitesSection: boolean
  /** KPI進捗表に表示する指標キー。1件以上必須 */
  kpiItems: string[]
}

export interface UserPreferences {
  hotelId: string
  dashboard: DashboardPreference
}

/** GET /api/v1/analysis/channels（#88） */
export interface ChannelBreakdown {
  hotelId: string
  year: number
  month: number
  channels: Array<{
    channel: string
    roomsSold: number
    revenue: number
    adr: number | null
    /** 室料売上に占める割合（%） */
    revenueShare: number
    /** 前月比（%）。前月の実績が無ければ null */
    revenueGrowth: number | null
  }>
}

/** GET /api/v1/analysis/room-types（#88） */
export interface RoomTypeBreakdown {
  hotelId: string
  year: number
  month: number
  actualDays: number
  roomTypes: Array<{
    roomTypeId: string
    name: string
    code: string
    count: number
    soldRooms: number
    revenue: number
    adr: number | null
    occupancy: number | null
  }>
}

/** GET /api/v1/analysis/day-of-week（#88） */
export interface DayOfWeekBreakdown {
  hotelId: string
  year: number
  month: number
  days: Array<{
    dayOfWeek: number
    isWeekend: boolean
    days: number
    soldRooms: number
    revenue: number
    occupancy: number | null
    adr: number | null
    revPar: number | null
  }>
}
