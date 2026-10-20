// バックエンドの API レスポンス・リクエストの型（#91 で lib/api.ts から分割）。
// 画面は @/lib/api から import する（このファイルを直接参照しない）。

import type {
  User,
  CompetitorOtaUrls,
  HotelType,
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
  // ---- 2026-10 の画面修正（DP02 / DP03 / DP04）----
  /** 日割り予算（月次予算を前年同曜日の販売室数の比で配ったもの）。予算が無ければ null */
  budgetRooms: number | null
  budgetOccupancy: number | null
  /** 月の予算ADR（どの日も同じ値） */
  budgetAdr: number | null
  budgetRevenue: number | null
  /** オンハンド（今の予約室数）。結果の出た日は販売室数 */
  onHandRooms: number | null
  /** 現在稼働率（結果の出た日は実績、先の日はオンハンド ÷ 客室数） */
  currentOccupancy: number | null
  /** 予約（オンハンド）のADR。予約の単価は PMS 連携（Phase 4）で入る。今は結果の出た日の実績ADR */
  onHandAdr: number | null
  /** 現在売上（結果の出た日は実績。予約の売上は PMS 連携後） */
  currentRevenue: number | null
  /** 想定売上 = AI の予測稼働率 × 客室数 × 予測ADR */
  expectedRevenue: number | null
  /**
   * 日のタイプ（日のモデル。例 "平日A型"）。平日・週末・特日ごとに過去の結果から作った型のうち、今の予約の入り方に近い型。
   * 過去の実績が足りず型を作れないホテルは null
   */
  dayType: string | null
  /** 日のタイプの優先モデル（稼働優先・バランス・単価優先） */
  dayTypeModel: DayModel | null
  /** 型の平均の最終稼働率 */
  dayTypeTypicalOccupancy: number | null
  /** 今より前の残日数ごとの日のタイプ（残日数の大きい順） */
  dayTypeHistory: DayTypeHistoryPoint[]
}

/** 稼働と単価のどちらを優先して価格を決めるか（日のタイプで決まる — 2026-10） */
export type DayModel = "occupancy" | "balanced" | "adr"

export interface DayTypeHistoryPoint {
  daysBefore: number
  dayType: string | null
  otbRooms: number | null
}

export interface PricingCalendar {
  hotelId: string
  year: number
  month: number
  /** 客室数（2026-10 から） */
  totalRooms?: number
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
  /** 日のタイプの優先モデル（稼働優先・単価優先）に合わせて日ごとに重みを寄せるか（2026-10） */
  dayModelAdjust: boolean
  /** 日単位のシミュレーションの価格弾力性（価格を1%上げると予約が何%減るか） */
  priceElasticity: number
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

/**
 * 期間・曜日ごとの価格の幅（推奨ランクの下限・上限 — D-11）。
 * ホテル全体の下限・上限より優先し、重なった期間は後から登録したものを優先する
 */
export interface PriceBoundPeriod {
  id: string
  hotelId: string
  startDate: string
  endDate: string
  /** 0=日〜6=土。空なら期間内の全日 */
  weekdays: number[]
  minRank: number | null
  maxRank: number | null
  reason: string | null
  createdAt: string
}

export interface CreatePriceBoundInput {
  hotelId: string
  startDate: string
  endDate: string
  weekdays: number[]
  minRank?: number | null
  maxRank?: number | null
  reason?: string
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
  /** pace = 前年同曜日と比べた予約の入り方、otbFloor = 予約済みの室数を下限にした引き上げ（D-11） */
  adjustments: Array<{
    key: "event" | "weekend" | "pace" | "otbFloor"
    impact: number
    input?: Record<string, number | string | null>
  }>
  excluded: Array<{ key: "occupancy" | "adr" | "competitor"; reason: "no_data" | "stale" | "zero_weight" }>
  /** periodMinRank / periodMaxRank は期間・曜日ごとの価格の幅（D-11） */
  guardrails: Array<{
    key: "minRank" | "maxRank" | "periodMinRank" | "periodMaxRank" | "maxDailyChange" | "hysteresis"
    from: number
    to: number
  }>
}

export interface BookingCurvePoint {
  daysBefore: number
  roomsBooked: number
  occupancy: number
}

export interface BookingCurve {
  hotelId: string
  stayDate: string
  totalRooms: number
  points: BookingCurvePoint[]
  /** 参考カーブ: 前年同曜日（364日前）の予約積上。前年同曜日が特殊日なら points は空 */
  reference?: {
    date: string
    points: BookingCurvePoint[]
    finalRooms: number | null
    finalOccupancy: number | null
    adr: number | null
  }
  /** その日の日割り予算 */
  budget?: { rooms: number | null; occupancy: number | null; adr: number | null }
  /** 今の AI の予測 */
  prediction?: { occupancy: number; rooms: number; adr: number | null } | null
  /** 結果（宿泊日を過ぎていれば） */
  actual?: { soldRooms: number | null; occupancy: number | null; adr: number | null } | null
  /**
   * PMS・サイトコントローラー連携（Phase 4）で入る系列。実 API はまだ返さず、デモデータだけが持つ。
   * adrHistory = 予約のADRの推移、rateHistory = 販売価格（料金）の履歴、groupRooms = 団体の予約室数
   */
  adrHistory?: Array<{ daysBefore: number; adr: number | null }>
  rateHistory?: Array<{ daysBefore: number; price: number | null }>
  groupRooms?: Array<{ daysBefore: number; rooms: number }>
  /** 部屋タイプ別・利用人数別の予約の積み上がりと ADR の推移（予約明細 — PMS 連携後。実 API はまだ返さず、デモデータだけが持つ） */
  breakdowns?: { roomType: BookingCurveSeries[]; guests: BookingCurveSeries[] }
}

export interface BookingCurveSeries {
  label: string
  points: Array<{ daysBefore: number; roomsBooked: number; adr: number | null }>
}

// ---- 日のAI分析（GET /pricing/day-insight・/pricing/day-simulation — 2026-10 PDF b01・b03）----

export interface DayInsight {
  date: string
  /** 日の区分（平日・週末・特日） */
  category: string
  dayType: { name: string; model: DayModel; typicalOccupancy: number } | null
  /** AI が推奨に優先モデルを使っているか（価格戦略の「日のタイプに合わせて重みを寄せる」） */
  modelApplied: boolean
  history: DayTypeHistoryPoint[]
  /** 選んだ日の型の典型（平均稼働・典型カーブ） */
  typeProfile: {
    name: string
    model: DayModel
    days: number
    avgOccupancy: number
    minOccupancy: number
    maxOccupancy: number
    avgAdr: number | null
    referenceCurve: Array<{ daysBefore: number; roomsBooked: number }>
  } | null
  /** 同じ区分の型の一覧（AI が作った型の数と構成） */
  categoryTypes: Array<{ name: string; model: DayModel; days: number; avgOccupancy: number; avgAdr: number | null }>
  /** 同じタイプの日（参考に5日まで。結果の出た日は実績、先の日は AI の予測） */
  similarDays: Array<{ date: string; dayType: string; isActual: boolean; occupancy: number | null; adr: number | null; recommendedPrice: number | null }>
  /** その日の外部要因（登録したイベント） */
  events: Array<{ name: string; type: string; location: string | null; expectedImpact: string | null; excludeFromHistory: boolean }>
  /** 天候（外部データの取り込み前のため null） */
  weather: null
}

export interface DaySimulationOption {
  /** 優先モデル。ランクを指定した試算は "manual" */
  model: DayModel | "manual"
  rank: number | null
  price: number | null
  adr: number | null
  weights: { occupancy: number; adr: number; competitor: number } | null
  isCurrent: boolean
  occupancy: number
  rooms: number
  revenue: number
  revPar: number
}

export interface DaySimulation {
  date: string
  totalRooms: number
  otbRooms: number | null
  /** 価格弾力性（価格を1%上げると予約が何%減るか） */
  elasticity: number
  /** AI が今この日に割り当てているモデル */
  aiModel: DayModel | null
  dayType: string | null
  base: { rank: number | null; price: number | null; adr: number | null; occupancy: number; rooms: number; revenue: number; revPar: number }
  options: DaySimulationOption[]
  manual: DaySimulationOption | null
}

// ---- 日別パフォーマンス（GET /analysis/daily-performance — 2026-10）----

export interface DayMetrics {
  soldRooms: number | null
  occupancy: number | null
  adr: number | null
  revPar: number | null
  revenue: number | null
}

export interface DailyPerformanceDay {
  date: string
  /** 実績（まだ結果の出ていない日は null） */
  actual: DayMetrics | null
  /** 予約実数（結果の出ていない日の今の予約室数・稼働率。予約の単価・売上は PMS 連携後のため null） */
  onHand: DayMetrics | null
  /** 日割り予算 */
  budget: DayMetrics
  /** AI の予測（推奨を作った日だけ） */
  ai: DayMetrics | null
  /** 前年同曜日（364日前） */
  lastYearDate: string
  lastYear: DayMetrics | null
}

export interface DailyPerformance {
  hotelId: string
  year: number
  month: number
  totalRooms: number
  days: DailyPerformanceDay[]
}

/** 月の予約の積み上がり（GET /analysis/month-pace — 日別パフォーマンスの月のグラフ） */
export interface MonthPacePoint {
  daysBefore: number
  /** 月の予約室数の合計（その時点） */
  rooms: number
  occupancy: number
  /** 前年同曜日の記録がある日だけの、今年と前年の予約室数の合計 */
  comparableRooms: number | null
  lastYearRooms: number | null
}

export interface MonthPace {
  hotelId: string
  year: number
  month: number
  totalRooms: number
  days: number
  budgetRooms: number | null
  budgetOccupancy: number | null
  aiRooms: number | null
  aiOccupancy: number | null
  /** 残日数の大きい順（180日前 → 結果）。月のどこかの日に記録が欠ける残日数・まだ来ていない残日数は含まない */
  points: MonthPacePoint[]
}

// ---- 周辺の新規ホテル（/new-hotels — 外部需要動向 2026-10）----

export type ImpactLevel = "high" | "medium" | "low"

export interface NewHotelOpening {
  id: string
  hotelId: string
  name: string
  openingDate: string
  rooms: number | null
  category: string | null
  location: string | null
  distanceKm: number | null
  expectedImpact: ImpactLevel | null
  notes: string | null
}

export interface NewHotelInput {
  name: string
  openingDate: string
  rooms?: number | null
  category?: string | null
  location?: string | null
  distanceKm?: number | null
  expectedImpact?: ImpactLevel | null
  notes?: string | null
}

/** 取り込み API（dryRun で確認 → 取り込み）の要約 */
export interface ImportResult {
  dryRun: boolean
  total: number
  created: number
  updated: number
  startDate: string
  endDate: string
}

export interface EventImportRow {
  name: string
  type: string
  startDate: string
  endDate: string
  location?: string
  expectedImpact?: ImpactLevel
  description?: string
  excludeFromHistory?: boolean
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
  /** 特殊日として予測の基準から外す（D-11） */
  excludeFromHistory?: boolean
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
  /** ホテルタイプとマーケット（#13）。null で未設定に戻す */
  hotelType?: HotelType | null
  prefectureCode?: string | null
  municipalityCode?: string | null
  marketArea?: string | null
  /** 販売開始: 宿泊日の何日前（2026-10）。null で未設定に戻す */
  saleOpenDaysBefore?: number | null
}

/** 初期設定の進み具合（#13）。GET /hotels/:id/setup-status */
export interface SetupStatus {
  hotelId: string
  /** 必須項目がすべて完了しているか */
  ready: boolean
  items: Array<{
    key: "basic" | "roomTypes" | "priceRanks" | "competitors" | "actuals" | "users" | "budget"
    label: string
    required: boolean
    done: boolean
    detail: string | null
  }>
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
  totalRooms: number
  /** 実績のある日数 */
  days: number
  /** 売上順 */
  channels: Array<{
    channel: string
    roomsSold: number
    revenue: number
    adr: number | null
    /** 稼働率への寄与 = 販売室数 ÷（客室数 × 実績のある日数） */
    occupancy: number | null
    /** 室料売上に占める割合（%） */
    revenueShare: number
    /** 販売室数に占める割合（%） */
    roomsShare: number
    lastYearRoomsSold: number | null
    lastYearRevenue: number | null
    /** 室料売上の前年同月比（%）。前年の実績が無ければ null（2026-10: 前月比はやめた） */
    revenueYoy: number | null
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
    revenueShare: number
    roomsShare: number
    lastYearSoldRooms: number | null
    lastYearRevenue: number | null
    /** 室料売上の前年同月比（%） */
    revenueYoy: number | null
  }>
}

/**
 * 曜日別・日のタイプ別パフォーマンスの1行（2026-10: 前月以前は実績、当月以降は実績＋予約）。
 * 販売室数・稼働率は実績＋予約、ADR・REV-Per・室料売上は結果の出た日だけ（予約の単価は PMS 連携後）
 */
export interface PerformanceRow {
  /** 数えた日数（実績か予約の記録がある日） */
  days: number
  /** うち結果の出た日 */
  actualDays: number
  /** 販売室数 = 実績＋予約 */
  soldRooms: number
  /** うち予約（結果の出ていない日の今の予約室数） */
  onHandRooms: number
  revenue: number
  occupancy: number | null
  adr: number | null
  revPar: number | null
  /** 前年同曜日（364日前）の実績の合計（比べられる日だけ） */
  lastYear: { days: number; soldRooms: number; revenue: number; occupancy: number | null; adr: number | null } | null
  /** 対象の日（"yyyy-MM-dd"） */
  dates: string[]
}

/** GET /api/v1/analysis/day-of-week（#88） */
export interface DayOfWeekBreakdown {
  hotelId: string
  year: number
  month: number
  days: Array<PerformanceRow & { dayOfWeek: number; isWeekend: boolean }>
}

/** GET /api/v1/analysis/day-type（日のタイプ別パフォーマンス — 2026-10） */
export interface DayTypeBreakdown {
  hotelId: string
  year: number
  month: number
  /** 型を作れなかった日（過去の実績が足りない） */
  untypedDays: number
  types: Array<PerformanceRow & { dayType: string; model: DayModel }>
}

// ---- 初期設定を速くする仕組み（#13） ----

export type IntegrationKind = "PMS" | "SITE_CONTROLLER"
export type IntegrationStatus = "PLANNED" | "TESTING" | "ACTIVE"

export interface HotelIntegration {
  id: string
  hotelId: string
  kind: IntegrationKind
  product: string
  connectionMethod: string | null
  status: IntegrationStatus
  note: string | null
  updatedAt: string
}

export type HotelIntegrationInput = Pick<HotelIntegration, "kind" | "product" | "connectionMethod" | "status" | "note">

export type CopyableSettingsItem = "roomTypes" | "priceRanks" | "strategy"

/** 初期設定シートの取り込み結果（シートごとの新規・更新の件数） */
export interface SetupWorkbookResult {
  dryRun: boolean
  basicUpdated: boolean
  roomTypes: { created: number; updated: number }
  priceRanks: { created: number; updated: number }
  competitors: { created: number; updated: number }
  budgets: { created: number; updated: number }
}

/** GET /settings/competitors/fetch-status の1行（取得元ごとの取得状況 — #9 段階C） */
export interface CompetitorFetchSourceStatus {
  source: string
  /** 自動取得の処理が登録されているか。false なら CSV の取り込みで入れる */
  automated: boolean
  competitorsWithUrl: number
  lastRun: {
    startedAt: string
    finishedAt: string | null
    status: "running" | "succeeded" | "failed" | string
    observations: number
    errorMessage: string | null
  } | null
  lastSucceededAt: string | null
  consecutiveFailures: number
}
