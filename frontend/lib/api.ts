"use client"

// バックエンドAPIクライアント（C-6）
// next.config.mjs の rewrites により /api/* はバックエンドへプロキシされる。
// 直接バックエンドURLを叩く場合は NEXT_PUBLIC_BACKEND_URL を設定する。

import type { ApiResponse, User, UserRole, Hotel as SharedHotel, Event as SharedEvent, PriceRank } from "@shared/types"

/** ホテル情報。外部要因（気象庁コード・緯度経度）の設定はバックエンド側で追加されたためここで拡張する */
export type Hotel = SharedHotel & {
  /** 気象庁 府県予報区コード（6桁。例 東京都=130000） */
  jmaOfficeCode?: string | null
  /** 気象庁 一次細分区域コード（6桁。例 東京地方=130010） */
  jmaAreaCode?: string | null
  latitude?: number | null
  longitude?: number | null
  /** イベント抽出などで使うLLMプロバイダ。null なら環境変数の既定に従う */
  llmProvider?: string | null
  /** LLMモデルID。null ならプロバイダの既定モデル */
  llmModel?: string | null
}

export type { PriceRank }

// ---- AIモデル（LLM）設定 ----

export type LlmProviderName = "anthropic" | "openai"

/** 実際に使われるLLMの選択。source は選択の由来（実行時指定 / ホテル設定 / 環境変数の既定） */
export interface LlmSelection {
  provider: LlmProviderName
  model: string
  source: "request" | "hotel" | "env"
}

export interface LlmProviderOption {
  id: LlmProviderName
  label: string
  /** サーバー側にAPIキーが設定されているか */
  configured: boolean
  defaultModel: string
  knownModels: Array<{ id: string; label: string }>
}

export interface LlmOptions {
  defaultProvider: LlmProviderName
  providers: LlmProviderOption[]
  /** このホテルで実際に使われる選択。null なら effectiveError に理由 */
  effective: LlmSelection | null
  effectiveError: string | null
}

/** イベント抽出の実行時にLLMを一時的に上書きする指定 */
export interface VenueExtractOptions {
  llmProvider?: LlmProviderName | null
  llmModel?: string | null
}

/** イベント影響度（バックエンド validators と同じ4値。共通型 Event には "negative" が未反映） */
export type EventImpact = "high" | "medium" | "low" | "negative"

export type EventSource = "manual" | "detected" | "extracted"
export type EventStatus = "candidate" | "confirmed" | "rejected"

/**
 * イベント。会場・候補ステータス等（外部要因設計 Phase 2）はバックエンド側で追加されたため
 * 共通型 Event を拡張する。旧レスポンスとの互換のためすべて optional
 */
export type HotelEvent = Omit<SharedEvent, "expectedImpact"> & {
  expectedImpact?: EventImpact
  venueId?: string | null
  venue?: { id: string; name: string } | null
  expectedAttendance?: number | null
  source?: EventSource
  status?: EventStatus
  /** 検出元（前年実績の期間・抽出元URL等） */
  sourceRef?: string | null
}

/** 承認待ちのイベント候補（status = candidate） */
export type EventCandidate = HotelEvent

export type VenueCategory = "dome" | "arena" | "hall" | "stadium" | "exhibition" | "other"

export interface Venue {
  id: string
  hotelId: string
  name: string
  category: VenueCategory | null
  address: string | null
  latitude: number | null
  longitude: number | null
  capacity: number | null
  distanceKm: number | null
  websiteUrl: string | null
  isActive: boolean
  /** 収容人数と距離から推定した需要影響度 */
  estimatedImpact: "high" | "medium" | "low" | null
  demandPressure: number | null
}

export interface CreateVenueInput {
  hotelId: string
  name: string
  category?: VenueCategory | null
  address?: string | null
  latitude?: number | null
  longitude?: number | null
  capacity?: number | null
  distanceKm?: number | null
  websiteUrl?: string | null
}

export type UpdateVenueInput = Partial<Omit<CreateVenueInput, "hotelId">>

export interface VenueExtractResult {
  venueId: string
  venueName: string
  url: string
  /** ページ本文が長すぎて途中で切り詰めた場合 true */
  truncated: boolean
  extracted: number
  created: number
  skippedDuplicates: number
  notes: string | null
  /** 抽出に実際に使われたLLM。旧レスポンスとの互換のため null 許容 */
  llm: LlmSelection | null
}

export interface DetectCandidatesResult {
  analyzedDays: number
  candidates: number
  created: number
  skippedExisting: number
}

export interface ReviewEventCandidateInput {
  decision: "approve" | "reject"
  name?: string
  type?: string
  startDate?: string
  endDate?: string
  expectedImpact?: EventImpact
}

export interface OtbImportInput {
  capturedAt?: string
  rows?: Array<{ stayDate: string; roomsBooked: number; daysBefore?: number }>
  /** ヘッダー `stayDate,roomsBooked[,daysBefore]` */
  csv?: string
}

export interface OtbImportResult {
  imported: number
  skipped: Array<{ stayDate: string; reason: string }>
  capturedAt: string
}

export interface CompetitorImportInput {
  rows?: Array<{
    competitorName: string
    date: string
    price1P?: number | null
    price2P?: number | null
    price3P?: number | null
    soldOut?: boolean
  }>
  /** ヘッダー `competitorName,date,price1P,price2P,price3P,soldOut` */
  csv?: string
}

export interface CompetitorImportResult {
  imported: number
  createdCompetitors: string[]
  skipped: Array<{ row: number; reason: string }>
}

export type ForecasterModelName = "rule-based-v2" | "ridge-v1"

export interface BacktestResult {
  modelVersion: string
  startDate: string
  endDate: string
  leadDays: number[]
  samples: number
  beatsBaseline: boolean
  summary: Array<{
    bucket: string
    samples: number
    mape: number
    bias: number
    baselineMape: number | null
  }>
}

export interface ModelComparison {
  hotelId: string
  activeForecaster: string
  results: BacktestResult[]
  promotable: Record<string, { ok: boolean; reason: string }>
  states: Array<{ modelName: string; samples: number; trainedAt: string }>
}

export interface TrainModelResult {
  modelName: string
  samples: number
  trainedAt: string
}

export interface PromoteModelResult {
  before: string
  after: string
  gate: { ok: boolean; reason: string }
}

// ---- AIチャット（Phase 4: 会話から推奨の説明・要因評価・基礎資料の引用・設定変更） ----

export interface ChatCitation {
  id: string
  /** "ドキュメント名 › 見出し" */
  path: string
  /** tenant = 個社MD（テナント固有）, global = 汎用MD（docs/knowledge） */
  scope?: "tenant" | "global"
  /** 表示用ラベル（例: 「【個社】デモホテル東京 個社MD › 価格方針」）。無ければ path を表示する */
  label?: string
}

/** 会話から実行した設定変更 */
export interface ChatAction {
  tool: string
  input: unknown
  ok: boolean
  summary: string
}

export interface ChatReplyMessage {
  id: string
  role: "assistant"
  content: string
  citations: ChatCitation[]
  actions: ChatAction[]
  llmProvider: string
  llmModel: string
  createdAt: string
}

export interface ChatReply {
  conversationId: string
  message: ChatReplyMessage
  toolsUsed: string[]
}

export interface SendChatMessageInput {
  hotelId: string
  conversationId?: string
  content: string
  llmProvider?: LlmProviderName
  llmModel?: string
}

export interface ChatConversationSummary {
  id: string
  title: string | null
  userId: string
  createdAt: string
  updatedAt: string
}

export interface ChatConversationMessage {
  id: string
  role: "user" | "assistant"
  content: string
  citations: ChatCitation[] | null
  actions: ChatAction[] | null
  llmProvider: string | null
  llmModel: string | null
  createdAt: string
}

export interface ChatConversation extends ChatConversationSummary {
  messages: ChatConversationMessage[]
}

/** チャットから利用できるツール（ロールに応じて write=true の変更系が含まれる） */
export interface ChatTool {
  name: string
  description: string
  write: boolean
}

export interface GenerateAiSummaryOptions {
  section?: string
  llmProvider?: LlmProviderName
  llmModel?: string
}

// ---- 要因の評価（アブレーション・成績表・推奨の効果） ----

/** contribution > 0 = 要因が精度に貢献（MAPE×100 の差、pt） */
export interface AblationRow {
  group: string
  label: string
  activeDays: number
  mapeWith: number
  mapeWithout: number
  contribution: number
}

export type FactorVerdict = "過小評価" | "過大評価" | "妥当" | "データ不足"

export interface FactorScorecardRow {
  key: string
  label: string
  group: string | null
  samples: number
  assumedPt: number
  meanResidualPt: number
  positiveShare: number
  verdict: FactorVerdict
}

export interface FactorEvaluation {
  hotelId: string
  lookbackDays: number
  samples: number
  ablation: AblationRow[]
  scorecard: FactorScorecardRow[]
}

export interface EffectGroupStats {
  days: number
  avgRevPar: number | null
  avgOccupancy: number | null
  avgAdr: number | null
}

export interface EffectRow {
  demandLevel: string
  adopted: EffectGroupStats
  overridden: EffectGroupStats
  none: EffectGroupStats
  revParDiffAdoptedVsOverridden: number | null
}

export interface RecommendationEffect {
  hotelId: string
  lookbackDays: number
  samples: number
  rows: EffectRow[]
  overall: EffectRow
  caveat: string
}

export interface SetCompetitorSoldOutIgnoredInput {
  hotelId: string
  competitorId: string
  /** YYYY-MM-DD */
  date: string
  ignored: boolean
  reason?: string
}

export interface CompetitorSoldOutResult {
  competitorId: string
  competitorName: string
  date: string
  soldOut: boolean
  soldOutIgnored: boolean
}

// ---- 基礎資料（知識ベース: docs/knowledge の Markdown） ----

export interface KnowledgeDocument {
  file: string
  title: string
  sections: number
}

export interface KnowledgeStatus {
  dir: string | null
  loadedAt: string | null
  chunks: number
  documents: KnowledgeDocument[]
}

export interface KnowledgeSearchHit {
  id: string
  path: string
  docTitle: string
  heading: string
  text: string
  score: number
}

export interface KnowledgeReloadResult {
  dir: string
  chunks: number
  documents: KnowledgeDocument[]
}

// ---- 個社MD（テナント固有の知識文書。「## ルール」節は機械が読む） ----

export type FactorGroup = "weather" | "event" | "school" | "holiday" | "special" | "comp" | "weekend"

export type DemandLevel = "A" | "B" | "C" | "D" | "E"

/** 「## ルール」節から解釈された個社ルール */
export interface HotelRules {
  minRank?: number
  maxRank?: number
  minPrice?: number
  maxDailyRankChange?: number
  competitorPositionPct?: number
  excludedCompetitors: string[]
  levelPolicies: Partial<Record<DemandLevel, string>>
  groupPolicy?: string
  disabledFactorGroups: FactorGroup[]
  enabledFactorGroups: FactorGroup[]
  autoAdopt?: boolean
  prohibitions: string[]
  notes: string[]
}

export interface RuleParseError {
  line: number
  text: string
  reason: string
}

export interface RuleParseResult {
  rules: HotelRules
  errors: RuleParseError[]
  /** 「## ルール」節が文書内に存在したか */
  found: boolean
}

/** ルール反映の結果（保存・再反映時） */
export interface ApplyRulesResult {
  hotelIds: string[]
  strategyUpdates: Record<string, unknown>
  excludedCompetitors: string[]
  competitorsNotFound: string[]
  lockedFactorKeys: string[]
  unlockedFactorKeys: string[]
  recomputedDays: number
}

export interface KnowledgeDocumentSummary {
  id: string
  /** null = テナント共通（全ホテルに適用） */
  hotelId: string | null
  title: string
  version: number
  rules: HotelRules | null
  rulesErrors: RuleParseError[] | null
  rulesAppliedAt: string | null
  isActive: boolean
  updatedAt: string
  updatedByUserId: string | null
}

export interface KnowledgeDocumentDetail extends KnowledgeDocumentSummary {
  tenantId: string
  body: string
  createdAt: string
  revisions: Array<{ version: number; createdAt: string; createdByUserId: string | null }>
}

export interface SaveKnowledgeDocumentInput {
  hotelId: string
  title: string
  body: string
  /** true のときテナント共通文書として保存する（hotelId = null） */
  tenantWide?: boolean
}

export interface SavedKnowledgeDocument {
  document: {
    id: string
    tenantId: string
    hotelId: string | null
    title: string
    version: number
    rules: HotelRules | null
    rulesErrors: RuleParseError[]
    rulesAppliedAt: string | null
    updatedAt: string
  }
  /** ルールを反映した場合の結果。ルール節なし・エラーありのときは null */
  applied: ApplyRulesResult | null
  rulesFound: boolean
  /** APIの message（例: 「個社MDを保存し、ルールを反映しました（91日を再計算）」）。フロントで付与する */
  message?: string
}

export interface ApplyKnowledgeDocumentResult {
  applied: ApplyRulesResult | null
  /** APIの message。フロントで付与する */
  message?: string
}

const ACCESS_TOKEN_KEY = "hrms.accessToken"
const REFRESH_TOKEN_KEY = "hrms.refreshToken"
const MOCK_USER_KEY = "hrms.mockUser"

const BASE_URL =
  typeof window !== "undefined" && process.env.NEXT_PUBLIC_BACKEND_URL
    ? process.env.NEXT_PUBLIC_BACKEND_URL
    : ""

export class ApiClientError extends Error {
  status: number
  /** バックエンド自体に到達できなかった（接続失敗/非JSON応答）場合のみ true。開発用モックログインの発火条件に使う。 */
  isBackendUnreachable: boolean
  constructor(status: number, message: string, isBackendUnreachable = false) {
    super(message)
    this.status = status
    this.isBackendUnreachable = isBackendUnreachable
  }
}

// ---- Token storage ----

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

export function storeTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken)
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  localStorage.removeItem(MOCK_USER_KEY)
}

// ---- デモモード（バックエンド未接続時のダミーデータ表示） ----
// NEXT_PUBLIC_DEMO_MODE=true のときのみ有効（next.config.mjs で既定値を設定）。
// バックエンドが応答する限り常に実APIを使用し、接続できない場合に限りダミーデータへ
// フォールバックする。フォールバックが起きた場合は画面上部にデモ表示バナーを出すため、
// 「モックへのサイレントフォールバック禁止」の規約には抵触しない。
// 本番でバックエンドを接続したら NEXT_PUBLIC_DEMO_MODE=false を設定すること。

const MOCK_PASSWORD = "Admin1234"
const MOCK_HOTEL_ID = "demo-hotel-001"
const MOCK_TENANT_ID = "mock-tenant"

const MOCK_ACCOUNTS: Record<string, { name: string; role: UserRole }> = {
  "admin@demo-hotel.example.com": { name: "管理者", role: "ADMIN" },
  "manager@demo-hotel.example.com": { name: "レベニューマネージャー", role: "MANAGER" },
  "operator@demo-hotel.example.com": { name: "フロント担当", role: "OPERATOR" },
}

const MOCK_HOTEL: Hotel = {
  id: MOCK_HOTEL_ID,
  tenantId: MOCK_TENANT_ID,
  name: "デモホテル東京",
  address: "東京都千代田区丸の内1-1-1",
  phone: "03-1234-5678",
  email: "info@demo-hotel.example.com",
  totalRooms: 200,
  weekendDays: [5, 6],
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  llmProvider: null,
  llmModel: null,
}

const MOCK_LLM_PROVIDERS: LlmProviderOption[] = [
  {
    id: "anthropic",
    label: "Anthropic（Claude）",
    configured: true,
    defaultModel: "claude-opus-5",
    knownModels: [
      { id: "claude-opus-5", label: "Claude Opus 5" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI（ChatGPT / GPT）",
    configured: false,
    defaultModel: "gpt-5",
    knownModels: [
      { id: "gpt-5", label: "GPT-5" },
      { id: "gpt-5-mini", label: "GPT-5 mini" },
    ],
  },
]

/** デモ時のLLM設定。ホテル設定（MOCK_HOTEL）に保存された選択があればそれを優先し、なければ環境変数の既定として扱う */
function getMockLlmOptions(): LlmOptions {
  const defaultProvider: LlmProviderName = "anthropic"
  const hotelProvider = MOCK_HOTEL.llmProvider === "anthropic" || MOCK_HOTEL.llmProvider === "openai" ? MOCK_HOTEL.llmProvider : null
  const providerId = hotelProvider ?? defaultProvider
  const provider = MOCK_LLM_PROVIDERS.find((p) => p.id === providerId)!
  const fromHotel = hotelProvider != null || (MOCK_HOTEL.llmModel != null && MOCK_HOTEL.llmModel !== "")
  const effective: LlmSelection | null = provider.configured
    ? { provider: providerId, model: MOCK_HOTEL.llmModel || provider.defaultModel, source: fromHotel ? "hotel" : "env" }
    : null
  return {
    defaultProvider,
    providers: MOCK_LLM_PROVIDERS,
    effective,
    effectiveError: effective ? null : `${provider.label} のAPIキーが設定されていません`,
  }
}

function isDemoModeEnabled(): boolean {
  // 明示的に "false" が設定されたときだけ無効化する。
  // ホスティング側の環境変数が未設定・値の誤り（例: "ture"）でもデモ表示が維持されるよう、
  // 「既定で有効・明示的に無効化」の向きにしている。
  // なおフォールバックの発動条件はバックエンドに到達できない場合のみで、
  // 実APIが応答する限り常に実データを優先する。
  return process.env.NEXT_PUBLIC_DEMO_MODE !== "false"
}

// ---- デモデータ表示状態（バナー通知用） ----
// フォールバックが1回でも発生したら true になり、画面上部にデモ表示バナーを出す。
let demoDataInUse = false

export function isDemoDataInUse(): boolean {
  return demoDataInUse
}

/** デモデータ利用開始を購読する（バナー表示用） */
export function subscribeDemoData(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  window.addEventListener("demoDataInUse", listener)
  return () => window.removeEventListener("demoDataInUse", listener)
}

function markDemoDataInUse() {
  if (demoDataInUse) return
  demoDataInUse = true
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("demoDataInUse"))
  }
}

function storeMockUser(user: User) {
  localStorage.setItem(MOCK_USER_KEY, JSON.stringify(user))
}

function getMockUser(): User | null {
  if (typeof window === "undefined") return null
  const raw = localStorage.getItem(MOCK_USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as User
  } catch {
    return null
  }
}

function mockLogin(email: string, password: string): LoginResult {
  const account = MOCK_ACCOUNTS[email]
  if (!account || password !== MOCK_PASSWORD) {
    throw new ApiClientError(401, "メールアドレスまたはパスワードが正しくありません")
  }
  const now = new Date()
  const user: User = {
    id: `mock-${account.role.toLowerCase()}`,
    tenantId: MOCK_TENANT_ID,
    email,
    name: account.name,
    role: account.role,
    hotelId: MOCK_HOTEL_ID,
    isActive: true,
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
  }
  return {
    user,
    tokens: { accessToken: `mock.${user.id}`, refreshToken: `mock-refresh.${user.id}` },
  }
}

async function withDemoFallback<T>(request: () => Promise<T>, fallback: () => T): Promise<T> {
  try {
    return await request()
  } catch (err) {
    if (isDemoModeEnabled() && err instanceof ApiClientError && err.isBackendUnreachable) {
      markDemoDataInUse()
      return fallback()
    }
    throw err
  }
}

// ---- Core request ----

async function rawRequest<T>(
  path: string,
  options: RequestInit = {},
  retryOn401 = true
): Promise<T> {
  const { data } = await rawRequestEnvelope<T>(path, options, retryOn401)
  return data
}

/** data に加えて API の message も返す（保存結果のトーストなど、message を表示したい場合に使う） */
async function rawRequestEnvelope<T>(
  path: string,
  options: RequestInit = {},
  retryOn401 = true
): Promise<{ data: T; message?: string }> {
  const token = getAccessToken()
  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers,
      },
    })
  } catch {
    throw new ApiClientError(0, "バックエンドに接続できません", true)
  }

  if (res.status === 401 && retryOn401 && getRefreshToken()) {
    const refreshed = await tryRefresh()
    if (refreshed) {
      return rawRequestEnvelope<T>(path, options, false)
    }
  }

  let body: ApiResponse<T>
  try {
    body = await res.json()
  } catch {
    throw new ApiClientError(res.status, `サーバーエラー (${res.status})`, true)
  }

  if (!res.ok || !body.success) {
    throw new ApiClientError(res.status, body.error || `リクエストに失敗しました (${res.status})`)
  }

  return { data: body.data as T, message: body.message }
}

async function tryRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return false
  try {
    const res = await fetch(`${BASE_URL}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    })
    const body = await res.json()
    if (res.ok && body.success && body.data?.tokens) {
      storeTokens(body.data.tokens.accessToken, body.data.tokens.refreshToken)
      return true
    }
  } catch {
    // fall through
  }
  clearTokens()
  return false
}

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

export interface DashboardKpi {
  hotelId: string
  year: number
  month: number
  summary: {
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
    actualSummary: {
      fiscalRevenue: number
      fiscalAdr: number
      fiscalOccupancy: number
      fiscalActualDays: number
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
  hotelId?: string
  section: string
  content: string
  /** 生成に使ったモデル（例 "anthropic/claude-sonnet-4-5"）。seed データでは null */
  modelVersion?: string | null
  generatedAt: string
  createdAt?: string
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
  competitorAvgPrice: number | null
  confidence: number | null
  /** 採用済みランク（RecommendationDecision の最新 appliedRank）。無ければ null */
  currentRank: number | null
  /** 推奨の理由分解。旧モデルの行は null */
  explanation: RecommendationExplanation | null
  expectedRevParCurrent: number | null
  expectedRevParRecommended: number | null
  modelVersion: string | null
}

/** 需要要因。pt は稼働率への寄与（0.05 = +5pt）。key 'base' は基準値そのもの */
export interface DemandFactor {
  key: string
  label: string
  pt: number
  detail?: string
}

/** ランク寄与。key 'base' は rank、その他は delta（ランク単位・小数あり）。合計 = 最終ランク */
export interface RankContribution {
  key: string
  label: string
  rank?: number
  delta?: number
  detail?: string
}

export interface RecommendationExplanation {
  modelVersion: string
  asOfDate: string
  leadDays: number
  demandFactors: DemandFactor[]
  activeFactorKeys: string[]
  unconstrainedOccupancy: number
  baseRank: number
  revenueOptimalRank: number
  candidates: { occupancy: number; adr: number; competitor: number | null }
  priceContributions: RankContribution[]
  comparisonRank: number
  expectedOccupancyRecommended: number
  confidence: { p10: number; p50: number; p90: number; leadBucket: string }
}

export interface PricingCalendar {
  hotelId: string
  year: number
  month: number
  calendar: PricingCalendarDay[]
}

export interface PricingStrategy {
  id: string
  hotelId: string
  weightOccupancy: number
  weightAdr: number
  weightCompetitor: number
  /** ガードレール（docs/外部要因設計.md） */
  minRank: number
  maxRank: number
  maxDailyRankChange: number
  competitorPositionPct: number
  /** 自動採用（日次ジョブが条件を満たす日の推奨を適用済みとして記録する） */
  autoAdopt: boolean
  /** 自動採用の最低信頼度（0〜1） */
  autoAdoptMinConfidence: number
  /** 自動採用の対象リードタイム（日） */
  autoAdoptMaxLeadDays: number
}

export interface UpdatePricingStrategyInput {
  weightOccupancy: number
  weightAdr: number
  weightCompetitor: number
  minRank?: number
  maxRank?: number
  maxDailyRankChange?: number
  competitorPositionPct?: number
  autoAdopt?: boolean
  autoAdoptMinConfidence?: number
  autoAdoptMaxLeadDays?: number
}

export interface PricingDigestPriorityDay {
  date: string
  recommendedRank: number
  recommendedPrice: number | null
  currentRank: number | null
  comparisonRank: number
  expectedRevParCurrent: number
  expectedRevParRecommended: number
  /** (推奨 − 比較対象) × 客室数。円。正負あり */
  expectedRevenueDelta: number
  demandLevel: "A" | "B" | "C" | "D" | "E" | null
  predictedOccupancy: number
  summary: string
  topFactors: DemandFactor[]
}

export interface PricingDigest {
  asOfDate: string
  totalRooms: number
  /** 期待増収額の絶対値降順、最大10件。推奨≠比較対象の日のみ */
  priorityDays: PricingDigestPriorityDay[]
  changesSinceYesterday: Array<{
    date: string
    previousRank: number
    newRank: number
    previousAsOfDate: string
    reasons: string[]
  }>
  yesterdayReview: {
    date: string
    predictedOccupancy: number
    actualOccupancy: number
    errorPt: number
    actualAdr: number | null
    actualRevPar: number | null
    comment: string
  } | null
  /** 直近30日の採否記録。adopted = appliedRank === recommendedRank */
  adoption: { decided: number; adopted: number; adoptionRate: number | null }
}

export interface RecommendationDecision {
  id: string
  hotelId: string
  stayDate: string
  recommendedRank: number
  appliedRank: number
  reason: string | null
  decidedByUserId: string | null
  createdAt: string
}

export interface RecordDecisionInput {
  hotelId: string
  /** YYYY-MM-DD */
  date: string
  appliedRank: number
  reason?: string
}

export interface DailySignal {
  date: string
  holiday: {
    known: boolean
    isHoliday: boolean
    holidayName: string | null
    nextDayOff: boolean
    nextDayIsHoliday: boolean
    blockLength: number
    blockHasHoliday: boolean
    position: "eve" | "within" | "last" | "none"
    isBridgeDay: boolean
    specialPeriod: "gw" | "obon" | "nenmatsu" | null
    schoolBreak: "spring" | "summer" | "winter" | null
  }
  weather: {
    weatherCode: string
    rainProbability: number | null
    tempMax: number | null
    tempMin: number | null
    reliability: string | null
    isRainy: boolean
    source: string
    capturedAt: string
  } | null
}

export interface SignalsIngestResult {
  hotelId: string
  jma: { count: number; reportDatetime: string; fallbackAreaCode: string | null } | null
  openMeteo: { count: number } | null
  skipped: string[]
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
  ownPrices: Array<{ date: string; price: number | null; isActual: boolean }>
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
    avgPrice: number | null
  }>
}

export interface CreateEventInput {
  hotelId: string
  name: string
  type: string
  startDate: string
  endDate: string
  location?: string
  /** 省略時、venueId が指定されていればバックエンドが会場情報から推定する */
  expectedImpact?: EventImpact
  description?: string
  venueId?: string
  expectedAttendance?: number
}

export type UpdateEventInput = Partial<Omit<CreateEventInput, "hotelId">>

export interface UpdateHotelSettingsInput {
  name?: string
  address?: string
  phone?: string
  email?: string
  totalRooms?: number
  weekendDays?: number[]
  /** 気象庁 府県予報区コード（6桁）。空にする場合は null */
  jmaOfficeCode?: string | null
  /** 気象庁 一次細分区域コード（6桁）。空にする場合は null */
  jmaAreaCode?: string | null
  latitude?: number | null
  longitude?: number | null
  /** LLMプロバイダ。環境変数の既定に戻す場合は null */
  llmProvider?: LlmProviderName | null
  /** LLMモデルID。プロバイダの既定に戻す場合は null */
  llmModel?: string | null
}

// ---- Dev-only demo data (ダッシュボード/ダイナミックプライシング画面用) ----
// バックエンドの seed データと近い分布になるよう簡易な季節・曜日変動を再現しているだけの
// ダミー値。実データではない。

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

function toLocalDateStr(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function isMockWeekend(date: Date): boolean {
  const weekendDays = Array.isArray(MOCK_HOTEL.weekendDays) ? (MOCK_HOTEL.weekendDays as number[]) : [5, 6]
  return weekendDays.includes(date.getDay())
}

function mockSeasonBoost(month: number): number {
  return 1 + 0.1 * Math.sin(((month + 1) / 12) * 2 * Math.PI)
}

function mockDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function mockRankToPrice1P(rank: number): number {
  const ratio = (rank - 1) / 39
  return Math.round(6500 + ratio * 23500)
}

function mockDashboardKpi(hotelId: string, year: number, month: number): DashboardKpi {
  const totalRooms = MOCK_HOTEL.totalRooms
  const numDays = mockDaysInMonth(year, month)
  const today = new Date()
  const rng = createSeededRandom(year * 100 + month)
  const boost = mockSeasonBoost(month)

  let totalRevenue = 0
  let soldRoomsSum = 0
  let guestsSum = 0
  let actualDays = 0
  const dailyTrend: DashboardKpi["dailyTrend"] = []

  for (let d = 1; d <= numDays; d++) {
    const date = new Date(year, month - 1, d)
    const weekend = isMockWeekend(date)
    const occupancy = Math.min(1, Math.max(0.3, (weekend ? 0.9 : 0.72) * boost + (rng() - 0.5) * 0.12))
    const adr = Math.round((weekend ? 23000 : 16500) * boost + (rng() - 0.5) * 1000)
    const isActual = date <= today
    const soldRooms = Math.round(occupancy * totalRooms)

    if (isActual) {
      actualDays += 1
      totalRevenue += soldRooms * adr
      soldRoomsSum += soldRooms
      guestsSum += Math.round(soldRooms * (1.3 + rng() * 0.4))
    }

    dailyTrend.push({
      date: toLocalDateStr(date),
      occupancy: isActual ? Number(occupancy.toFixed(3)) : null,
      adr: isActual ? adr : null,
      predictedOccupancy: Number(Math.min(1, occupancy + (rng() - 0.5) * 0.06).toFixed(3)),
      predictedAdr: Math.round(adr * (1 + (rng() - 0.5) * 0.05)),
      // 前年同月同日の実績（モックでは当年から数%低い水準として生成）
      lastYearOccupancy: Number(Math.max(0.2, occupancy * (0.93 + rng() * 0.06)).toFixed(3)),
      lastYearAdr: Math.round(adr * (0.9 + rng() * 0.06)),
      isActual,
    })
  }

  const adr = soldRoomsSum > 0 ? Math.round(totalRevenue / soldRoomsSum) : 0
  const occupancyRate = actualDays > 0 ? soldRoomsSum / (totalRooms * actualDays) : 0
  const revPar = actualDays > 0 ? totalRevenue / (totalRooms * actualDays) : 0
  // DOR = 宿泊人数 / 販売室数（1室あたり平均利用人数）
  const dor = soldRoomsSum > 0 ? Math.round((guestsSum / soldRoomsSum) * 100) / 100 : 0
  const guestUnitPrice = guestsSum > 0 ? Math.round(totalRevenue / guestsSum) : 0

  const budgetOccupancy = 0.78
  const budgetAdr = 18500
  const budgetRevenue = Math.round(budgetAdr * budgetOccupancy * totalRooms * numDays)
  const budgetRevenueToDate = actualDays > 0 ? Math.round((budgetRevenue / numDays) * actualDays) : null
  const lastYearRevenue = Math.round(budgetRevenue * 0.95)
  const lastYearAdr = 17200
  const lastYearOccupancy = 0.74

  const mockRatio = (actual: number | null, target: number | null): number | null =>
    actual == null || target == null || target === 0 ? null : Number((actual / target).toFixed(3))

  const mockAxis = (
    budgetRev: number | null,
    lastYearRev: number | null,
    actualRevenue: number,
    actualAdr: number,
    actualOccupancy: number
  ): ComparisonAxis => ({
    budgetRevenue: budgetRev,
    budgetRevenueRatio: mockRatio(actualRevenue, budgetRev),
    budgetAdr,
    budgetAdrRatio: mockRatio(actualAdr, budgetAdr),
    budgetOccupancy,
    budgetOccupancyRatio: mockRatio(actualOccupancy, budgetOccupancy),
    lastYearRevenue: lastYearRev,
    lastYearRevenueRatio: mockRatio(actualRevenue, lastYearRev),
    lastYearAdr,
    lastYearAdrRatio: mockRatio(actualAdr, lastYearAdr),
    lastYearOccupancy,
    lastYearOccupancyRatio: mockRatio(actualOccupancy, lastYearOccupancy),
  })

  // 年度累計（4月始まり）のモック: 経過月数ぶんを当月実績から外挿する
  const fiscalStartYear = month >= 4 ? year : year - 1
  const elapsedFiscalMonths = month >= 4 ? month - 3 : month + 9
  const fiscalRevenue = Math.round(totalRevenue * elapsedFiscalMonths * 0.98)
  const fiscalBudgetRevenue = Math.round((budgetRevenueToDate ?? 0) * elapsedFiscalMonths)
  const fiscalLastYearRevenue = Math.round(fiscalBudgetRevenue * 0.95)

  return {
    hotelId,
    year,
    month,
    summary: {
      roomRevenue: Math.round(totalRevenue),
      soldRooms: soldRoomsSum,
      adr,
      occupancyRate: Number(occupancyRate.toFixed(3)),
      revPar: Math.round(revPar),
      guests: guestsSum,
      dor,
      guestUnitPrice,
      actualDays,
    },
    comparison:
      actualDays > 0 && budgetRevenueToDate
        ? {
            budgetRevenue,
            budgetRevenueToDate,
            budgetRatioToDate: Number((totalRevenue / budgetRevenueToDate).toFixed(3)),
            budgetAdr,
            budgetOccupancy,
            lastYearRevenue,
            lastYearRatio: Number((totalRevenue / (lastYearRevenue * (actualDays / numDays))).toFixed(3)),
            lastYearAdr,
            lastYearOccupancy,
            toDate: mockAxis(
              budgetRevenueToDate,
              Math.round(lastYearRevenue * (actualDays / numDays)),
              totalRevenue,
              adr,
              occupancyRate
            ),
            cumulative: mockAxis(budgetRevenue, lastYearRevenue, totalRevenue, adr, occupancyRate),
            fiscalYear: mockAxis(
              fiscalBudgetRevenue,
              fiscalLastYearRevenue,
              fiscalRevenue,
              adr,
              occupancyRate
            ),
            fiscalYearLabel: `${fiscalStartYear}年度（4月〜${month}月）`,
            actualSummary: {
              fiscalRevenue,
              fiscalAdr: adr,
              fiscalOccupancy: Number(occupancyRate.toFixed(3)),
              fiscalActualDays: actualDays * elapsedFiscalMonths,
            },
          }
        : null,
    dailyTrend,
    simulation: {
      projectedRevenue: Math.round(budgetAdr * 1.02 * 0.81 * totalRooms * numDays),
      projectedAdr: Math.round(budgetAdr * 1.02),
      projectedOccupancy: 0.81,
      projectedRevPar: Math.round(budgetAdr * 1.02 * 0.81),
    },
  }
}

function mockAlerts(minLevel?: number): AlertItem[] {
  const today = new Date()
  const plusDays = (n: number) => {
    const d = new Date(today)
    d.setDate(d.getDate() + n)
    return toLocalDateStr(d)
  }
  const all: AlertItem[] = [
    {
      id: "mock-alert-1",
      severity: "RED",
      level: 5,
      title: "稼働率が予算を大幅に下回っています",
      message: "来週火曜の予約積上が予算比 -18pt です。価格ランクの引き下げを検討してください。",
      linkTab: "pricing",
      targetDate: plusDays(4),
      status: "OPEN",
      detectedAt: today.toISOString(),
    },
    {
      id: "mock-alert-2",
      severity: "YELLOW",
      level: 4,
      title: "競合価格との乖離が拡大",
      message: "今週末の自社価格が競合水準より 12% 高くなっています。経過観察してください。",
      linkTab: "daily",
      targetDate: plusDays(2),
      status: "OPEN",
      detectedAt: today.toISOString(),
    },
    {
      id: "mock-alert-3",
      severity: "YELLOW",
      level: 3,
      title: "OTA別の予約構成比に変化",
      message: "公式サイト経由の構成比が前月比 -4pt です。チャネル分析で推移を確認してください。",
      linkTab: "analysis",
      targetDate: plusDays(7),
      status: "OPEN",
      detectedAt: today.toISOString(),
    },
    {
      id: "mock-alert-4",
      severity: "YELLOW",
      level: 2,
      title: "翌月の予算未登録",
      message: "翌月の予算データが未登録です。設定画面から登録してください。",
      linkTab: "settings",
      targetDate: null,
      status: "OPEN",
      detectedAt: today.toISOString(),
    },
    {
      id: "mock-alert-5",
      severity: "YELLOW",
      level: 1,
      title: "料金ランクの見直し推奨",
      message: "直近30日で未使用の料金ランクが3件あります。マスタ整理を検討してください。",
      linkTab: "settings",
      targetDate: null,
      status: "OPEN",
      detectedAt: today.toISOString(),
    },
  ]
  return minLevel != null ? all.filter((a) => a.level >= minLevel) : all
}

function mockAiSummary(section?: string): AiSummary {
  return {
    id: "mock-ai-summary",
    section: section ?? "dashboard-summary",
    modelVersion: null,
    content:
      "今月の稼働率は予算比 +2.1pt と好調に推移しています。週末（金・土）のADRは前年比 +6% で、" +
      "特に土曜日は満室に近い水準です。一方、平日火曜・水曜の稼働が予算を下回っており、" +
      "平日限定プランまたは料金ランク引き下げの検討を推奨します。",
    generatedAt: new Date().toISOString(),
  }
}

// ---- 外部要因のモック（祝日・特別期間・天候。デモ表示用の簡易判定で、実データではない） ----

// 年に依存しない近似の祝日表（移動祝日は代表日で近似）
const MOCK_HOLIDAYS: Record<string, string> = {
  "1-1": "元日",
  "1-12": "成人の日",
  "2-11": "建国記念の日",
  "2-23": "天皇誕生日",
  "3-20": "春分の日",
  "4-29": "昭和の日",
  "5-3": "憲法記念日",
  "5-4": "みどりの日",
  "5-5": "こどもの日",
  "7-20": "海の日",
  "8-11": "山の日",
  "9-21": "敬老の日",
  "9-23": "秋分の日",
  "10-12": "スポーツの日",
  "11-3": "文化の日",
  "11-23": "勤労感謝の日",
}

function mockHolidayName(date: Date): string | null {
  return MOCK_HOLIDAYS[`${date.getMonth() + 1}-${date.getDate()}`] ?? null
}

function mockSpecialPeriod(date: Date): DailySignal["holiday"]["specialPeriod"] {
  const m = date.getMonth() + 1
  const d = date.getDate()
  if ((m === 4 && d >= 29) || (m === 5 && d <= 5)) return "gw"
  if (m === 8 && d >= 13 && d <= 16) return "obon"
  if ((m === 12 && d >= 29) || (m === 1 && d <= 3)) return "nenmatsu"
  return null
}

function mockSchoolBreak(date: Date): DailySignal["holiday"]["schoolBreak"] {
  const m = date.getMonth() + 1
  const d = date.getDate()
  if ((m === 7 && d >= 21) || m === 8) return "summer"
  if ((m === 12 && d >= 25) || (m === 1 && d <= 7)) return "winter"
  if ((m === 3 && d >= 25) || (m === 4 && d <= 5)) return "spring"
  return null
}

/** 休日（土日・祝日・特別期間）かどうか */
function mockIsDayOff(date: Date): boolean {
  const dow = date.getDay()
  return dow === 0 || dow === 6 || mockHolidayName(date) != null || mockSpecialPeriod(date) != null
}

function mockAddDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function mockDaysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime()
  return Math.round((b - a) / 86_400_000)
}

/** 連休ブロック（休日が連続する範囲）を返す。休日でなければ null */
function mockHolidayBlock(date: Date): { start: Date; end: Date; length: number; hasHoliday: boolean } | null {
  if (!mockIsDayOff(date)) return null
  let start = new Date(date)
  while (mockIsDayOff(mockAddDays(start, -1))) start = mockAddDays(start, -1)
  let end = new Date(date)
  while (mockIsDayOff(mockAddDays(end, 1))) end = mockAddDays(end, 1)
  const length = mockDaysBetween(start, end) + 1
  let hasHoliday = false
  for (let d = new Date(start); d <= end; d = mockAddDays(d, 1)) {
    if (mockHolidayName(d) != null || mockSpecialPeriod(d) != null) hasHoliday = true
  }
  return { start, end, length, hasHoliday }
}

function mockHolidaySignal(date: Date): DailySignal["holiday"] {
  const next = mockAddDays(date, 1)
  const prev = mockAddDays(date, -1)
  const block = mockHolidayBlock(date)
  const nextBlock = mockHolidayBlock(next)
  const nextDayOff = nextBlock != null
  let position: DailySignal["holiday"]["position"] = "none"
  if (block) {
    position = mockDaysBetween(date, block.end) === 0 ? "last" : "within"
  } else if (nextDayOff && (nextBlock?.length ?? 0) >= 2) {
    position = "eve"
  }
  const isBridgeDay = !block && mockIsDayOff(prev) && nextDayOff
  return {
    known: true,
    isHoliday: mockHolidayName(date) != null,
    holidayName: mockHolidayName(date),
    nextDayOff,
    nextDayIsHoliday: mockHolidayName(next) != null,
    blockLength: block?.length ?? nextBlock?.length ?? 0,
    blockHasHoliday: block?.hasHoliday ?? nextBlock?.hasHoliday ?? false,
    position,
    isBridgeDay,
    specialPeriod: mockSpecialPeriod(date),
    schoolBreak: mockSchoolBreak(date),
  }
}

/** 天候予報のモック（今日から14日先まで。日付から決定的に導出） */
function mockWeatherSignal(date: Date, today: Date): DailySignal["weather"] {
  const lead = mockDaysBetween(today, date)
  if (lead < 0 || lead > 14) return null
  const dayNum = date.getDate()
  const rainProbability = ((dayNum * 37 + date.getMonth() * 11) % 100)
  const isRainy = rainProbability >= 60
  const month = date.getMonth() + 1
  const tempBase = 8 + 14 * Math.sin(((month - 4) / 12) * 2 * Math.PI) + 10
  return {
    weatherCode: isRainy ? "300" : rainProbability >= 40 ? "200" : "100",
    rainProbability,
    tempMax: Math.round(tempBase + 4),
    tempMin: Math.round(tempBase - 4),
    reliability: lead <= 3 ? "A" : lead <= 7 ? "B" : "C",
    isRainy,
    source: lead <= 7 ? "jma" : "open_meteo",
    capturedAt: today.toISOString(),
  }
}

function mockSignals(startDate: string, endDate: string): DailySignal[] {
  const today = new Date()
  return eachMockDate(startDate, endDate).map((date) => ({
    date: toLocalDateStr(date),
    holiday: mockHolidaySignal(date),
    weather: mockWeatherSignal(date, today),
  }))
}

function mockIngestSignals(hotelId: string): SignalsIngestResult {
  return {
    hotelId,
    jma: { count: 7, reportDatetime: new Date().toISOString(), fallbackAreaCode: null },
    openMeteo: { count: 9 },
    skipped: [],
  }
}

// ---- 採否記録のモック（メモリ上に保持。採用操作の結果を画面で確認できるようにする） ----
const mockDecisionStore = new Map<string, RecommendationDecision>()

function mockLeadBucket(leadDays: number): string {
  if (leadDays <= 3) return "lead0_3"
  if (leadDays <= 7) return "lead4_7"
  if (leadDays <= 30) return "lead8_30"
  if (leadDays <= 90) return "lead31_90"
  return "lead91"
}

const MOCK_MODEL_VERSION = "demand-v2-mock"

function mockPricingCalendar(hotelId: string, year: number, month: number): PricingCalendar {
  const numDays = mockDaysInMonth(year, month)
  const today = new Date()
  const rng = createSeededRandom(year * 100 + month + 7)
  const boost = mockSeasonBoost(month)
  const calendar: PricingCalendarDay[] = []
  const strategy = mockStrategy
  const ranks = getMockPriceRanks(hotelId)
  const priceOf = (rank: number) =>
    ranks.find((r) => r.rank === rank)?.price1P ?? mockRankToPrice1P(rank)
  const clampRank = (r: number) => Math.min(40, Math.max(1, r))

  for (let d = 1; d <= numDays; d++) {
    const date = new Date(year, month - 1, d)
    const weekend = isMockWeekend(date)
    const isPast = date < today
    const leadDays = mockDaysBetween(today, date)
    const holidaySignal = mockHolidaySignal(date)
    const weather = mockWeatherSignal(date, today)

    // ---- 需要の内訳（稼働率への寄与 pt）
    const base = Number((0.64 * boost).toFixed(3))
    const demandFactors: DemandFactor[] = [
      { key: "base", label: "基準稼働率", pt: base, detail: `${month}月の曜日平均（季節係数 ${boost.toFixed(2)}）` },
    ]
    if (weekend) demandFactors.push({ key: "weekend", label: "週末（金・土）", pt: 0.14 })
    if (holidaySignal.position === "eve") {
      demandFactors.push({ key: "holiday_eve", label: `${holidaySignal.blockLength}連休の前日`, pt: 0.08 })
    } else if (holidaySignal.position === "within" && holidaySignal.blockLength >= 3) {
      demandFactors.push({ key: "holiday_mid", label: "3連休以上の中日", pt: 0.12 })
    } else if (holidaySignal.position === "last" && holidaySignal.blockLength >= 2) {
      demandFactors.push({ key: "holiday_last", label: "連休最終日", pt: -0.06 })
    }
    if (holidaySignal.specialPeriod) {
      const labels = { gw: "ゴールデンウィーク", obon: "お盆", nenmatsu: "年末年始" } as const
      demandFactors.push({ key: `special_${holidaySignal.specialPeriod}`, label: labels[holidaySignal.specialPeriod], pt: 0.1 })
    }
    if (d === 15) demandFactors.push({ key: "event", label: "近隣イベント（地域花火大会）", pt: 0.09 })
    const pace = Number(((rng() - 0.5) * 0.12).toFixed(3))
    demandFactors.push({
      key: "pace",
      label: "予約ペース",
      pt: pace,
      detail: `同リードタイムの平年比 ${pace >= 0 ? "+" : ""}${Math.round(pace * 100)}pt`,
    })
    if (weather?.isRainy) {
      demandFactors.push({ key: "rain", label: "雨天予報", pt: -0.04, detail: `降水確率 ${weather.rainProbability}%` })
    }
    const unconstrainedOccupancy = demandFactors.reduce((sum, f) => sum + f.pt, 0)
    const predictedOccupancy = Number(Math.min(1, Math.max(0.3, unconstrainedOccupancy)).toFixed(3))
    const predictedAdr = Math.round((weekend ? 24000 : 17000) * boost)
    const competitorAvgPrice = Math.round((weekend ? 22000 : 15500) * boost * (0.95 + rng() * 0.15))

    // ---- ランクの内訳（重み付け合成 → ガードレール）
    const baseRank = clampRank(Math.round(predictedOccupancy * 40))
    const revenueOptimalRank = clampRank(baseRank + 1)
    const occCandidate = clampRank(baseRank - 2)
    const adrCandidate = clampRank(baseRank + 2)
    const compCandidate = clampRank(baseRank + Math.round((competitorAvgPrice / priceOf(baseRank) - 1) * 10))
    const totalWeight = strategy.weightOccupancy + strategy.weightAdr + strategy.weightCompetitor || 100
    const occDelta = (strategy.weightOccupancy / totalWeight) * (occCandidate - baseRank)
    const adrDelta = (strategy.weightAdr / totalWeight) * (adrCandidate - baseRank)
    const compDelta = (strategy.weightCompetitor / totalWeight) * (compCandidate - baseRank)
    const blended = baseRank + occDelta + adrDelta + compDelta
    const blendedRank = Math.round(blended)
    const roundingDelta = blendedRank - blended

    const prior = mockDecisionStore.get(`${hotelId}:${toLocalDateStr(date)}`)
    // 採用済みランク: 採否記録があればそれ、無ければ一部の日にサイトコントローラー由来の値があるものとして疑似生成
    const seededCurrent = d % 4 === 0 ? clampRank(blendedRank + 1) : d % 4 === 2 ? clampRank(blendedRank - 1) : null
    const currentRank = prior?.appliedRank ?? seededCurrent
    const reference = currentRank ?? baseRank
    let finalRank = clampRank(Math.min(strategy.maxRank, Math.max(strategy.minRank, blendedRank)))
    finalRank = clampRank(
      Math.min(reference + strategy.maxDailyRankChange, Math.max(reference - strategy.maxDailyRankChange, finalRank))
    )
    const guardDelta = finalRank - blendedRank

    const priceContributions: RankContribution[] = [
      { key: "base", label: "基準ランク（需要予測）", rank: baseRank, detail: `予測稼働率 ${(predictedOccupancy * 100).toFixed(0)}%` },
      {
        key: "occupancy",
        label: `稼働率重視（${strategy.weightOccupancy}%）`,
        delta: occDelta,
        detail: `候補 R${occCandidate}（収益最大 R${revenueOptimalRank} から RevPAR −5% 以内で最も低いランク）`,
      },
      {
        key: "adr",
        label: `ADR重視（${strategy.weightAdr}%）`,
        delta: adrDelta,
        detail: `候補 R${adrCandidate}（収益最大 R${revenueOptimalRank} から RevPAR −5% 以内で最も高いランク）`,
      },
      {
        key: "competitor",
        label: `競合追従（${strategy.weightCompetitor}%）`,
        delta: compDelta,
        detail: `候補 R${compCandidate}（競合中央値 ¥${competitorAvgPrice.toLocaleString()}）`,
      },
    ]
    if (Math.abs(roundingDelta) > 1e-9) priceContributions.push({ key: "rounding", label: "端数処理", delta: roundingDelta })
    if (guardDelta !== 0) {
      priceContributions.push({
        key: "guardrail",
        label: "ガードレール",
        delta: guardDelta,
        detail:
          Math.abs(blendedRank - reference) > strategy.maxDailyRankChange
            ? `1回の最大変動 ±${strategy.maxDailyRankChange}（参照 R${reference}）`
            : `ランク範囲 R${strategy.minRank}〜R${strategy.maxRank}`,
      })
    }

    // ---- 期待RevPAR（比較対象 = 採用済みランク → 基準ランク）。価格弾力性は簡易近似
    const comparisonRank = reference
    const occAt = (rank: number) =>
      Math.min(1, Math.max(0.05, predictedOccupancy * (1 - (rank - baseRank) * 0.02)))
    const expectedOccupancyRecommended = Number(occAt(finalRank).toFixed(3))
    const expectedRevParRecommended = Math.round(priceOf(finalRank) * expectedOccupancyRecommended)
    const expectedRevParCurrent = Math.round(priceOf(comparisonRank) * occAt(comparisonRank))

    const spread = leadDays <= 3 ? 0.04 : leadDays <= 7 ? 0.07 : leadDays <= 30 ? 0.1 : 0.14
    const price1P = priceOf(finalRank)
    const demandLevel: PricingCalendarDay["demandLevel"] =
      predictedOccupancy > 0.9 ? "A" : predictedOccupancy > 0.8 ? "B" : predictedOccupancy > 0.65 ? "C" : predictedOccupancy > 0.5 ? "D" : "E"

    calendar.push({
      date: toLocalDateStr(date),
      demandLevel,
      recommendedRank: finalRank,
      recommendedPrice: price1P,
      rankLabel: `R${String(finalRank).padStart(2, "0")}`,
      price1P,
      price2P: Math.round(price1P * 1.4),
      price3P: Math.round(price1P * 1.8),
      predictedOccupancy,
      predictedAdr,
      actualOccupancy: isPast ? Number(Math.min(1, predictedOccupancy + (rng() - 0.5) * 0.1).toFixed(3)) : null,
      actualAdr: isPast ? Math.round(predictedAdr * (1 + (rng() - 0.5) * 0.06)) : null,
      competitorAvgPrice,
      confidence: Number((1 - spread * 2).toFixed(2)),
      currentRank,
      explanation: {
        modelVersion: MOCK_MODEL_VERSION,
        asOfDate: toLocalDateStr(today),
        leadDays,
        demandFactors,
        activeFactorKeys: demandFactors.filter((f) => f.key !== "base").map((f) => f.key),
        unconstrainedOccupancy: Number(unconstrainedOccupancy.toFixed(3)),
        baseRank,
        revenueOptimalRank,
        candidates: { occupancy: occCandidate, adr: adrCandidate, competitor: compCandidate },
        priceContributions,
        comparisonRank,
        expectedOccupancyRecommended,
        confidence: {
          p10: Number(Math.max(0, predictedOccupancy - spread).toFixed(3)),
          p50: predictedOccupancy,
          p90: Number(Math.min(1, predictedOccupancy + spread).toFixed(3)),
          leadBucket: mockLeadBucket(leadDays),
        },
      },
      expectedRevParCurrent,
      expectedRevParRecommended,
      modelVersion: MOCK_MODEL_VERSION,
    })
  }

  return { hotelId, year, month, calendar }
}

function mockRecordDecision(input: RecordDecisionInput): RecommendationDecision {
  const [y, m] = input.date.split("-").map(Number)
  const day = mockPricingCalendar(input.hotelId, y, m).calendar.find((c) => c.date === input.date)
  if (!day || day.recommendedRank == null) throw new ApiClientError(404, "対象日の推奨が見つかりません")
  const decision: RecommendationDecision = {
    id: `mock-decision-${Date.now()}`,
    hotelId: input.hotelId,
    stayDate: input.date,
    recommendedRank: day.recommendedRank,
    appliedRank: input.appliedRank,
    reason: input.reason ?? null,
    decidedByUserId: getMockUser()?.id ?? null,
    createdAt: new Date().toISOString(),
  }
  mockDecisionStore.set(`${input.hotelId}:${input.date}`, decision)
  return decision
}

function getMockDecisions(hotelId: string, startDate: string, endDate: string): RecommendationDecision[] {
  return Array.from(mockDecisionStore.values()).filter(
    (d) => d.hotelId === hotelId && d.stayDate >= startDate && d.stayDate <= endDate
  )
}

function mockFactorSummary(factors: DemandFactor[]): string {
  const parts = factors
    .filter((f) => f.key !== "base")
    .sort((a, b) => Math.abs(b.pt) - Math.abs(a.pt))
    .slice(0, 2)
    .map((f) => `${f.label} ${f.pt >= 0 ? "+" : "−"}${Math.abs(Math.round(f.pt * 100))}pt`)
  return parts.length > 0 ? parts.join("、") : "基準値どおり"
}

function mockPricingDigest(hotelId: string): PricingDigest {
  const today = new Date()
  const totalRooms = MOCK_HOTEL.totalRooms
  const horizonEnd = mockAddDays(today, 60)
  const months: Array<{ year: number; month: number }> = []
  for (let cursor = new Date(today.getFullYear(), today.getMonth(), 1); cursor <= horizonEnd; cursor.setMonth(cursor.getMonth() + 1)) {
    months.push({ year: cursor.getFullYear(), month: cursor.getMonth() + 1 })
  }
  const days = months.flatMap(({ year, month }) => mockPricingCalendar(hotelId, year, month).calendar)
  const todayStr = toLocalDateStr(today)
  const horizonStr = toLocalDateStr(horizonEnd)

  const priorityDays: PricingDigest["priorityDays"] = days
    .filter(
      (d) =>
        d.date >= todayStr &&
        d.date <= horizonStr &&
        d.explanation != null &&
        d.recommendedRank != null &&
        d.recommendedRank !== d.explanation.comparisonRank &&
        d.expectedRevParCurrent != null &&
        d.expectedRevParRecommended != null
    )
    .map((d) => {
      const explanation = d.explanation!
      const topFactors = explanation.demandFactors
        .filter((f) => f.key !== "base")
        .sort((a, b) => Math.abs(b.pt) - Math.abs(a.pt))
        .slice(0, 3)
      return {
        date: d.date,
        recommendedRank: d.recommendedRank!,
        recommendedPrice: d.recommendedPrice,
        currentRank: d.currentRank,
        comparisonRank: explanation.comparisonRank,
        expectedRevParCurrent: d.expectedRevParCurrent!,
        expectedRevParRecommended: d.expectedRevParRecommended!,
        expectedRevenueDelta: Math.round((d.expectedRevParRecommended! - d.expectedRevParCurrent!) * totalRooms),
        demandLevel: d.demandLevel,
        predictedOccupancy: d.predictedOccupancy ?? 0,
        summary: mockFactorSummary(explanation.demandFactors),
        topFactors,
      }
    })
    .sort((a, b) => Math.abs(b.expectedRevenueDelta) - Math.abs(a.expectedRevenueDelta))
    .slice(0, 10)

  const yesterday = mockAddDays(today, -1)
  const changeCandidates = days.filter((d) => d.date > todayStr && d.recommendedRank != null).slice(0, 40)
  const changesSinceYesterday: PricingDigest["changesSinceYesterday"] = changeCandidates
    .filter((_, i) => i % 9 === 3)
    .slice(0, 4)
    .map((d, i) => {
      const newRank = d.recommendedRank!
      const previousRank = Math.min(40, Math.max(1, newRank + (i % 2 === 0 ? -1 : 2)))
      const reasons = [
        newRank > previousRank ? "予約ペースが平年比で加速" : "予約ペースが平年比で鈍化",
        ...(d.explanation?.demandFactors.some((f) => f.key === "rain") ? ["雨天予報を反映"] : []),
      ]
      return { date: d.date, previousRank, newRank, previousAsOfDate: toLocalDateStr(yesterday), reasons }
    })

  const yesterdayDay = days.find((d) => d.date === toLocalDateStr(yesterday))
  const yesterdayReview: PricingDigest["yesterdayReview"] =
    yesterdayDay && yesterdayDay.actualOccupancy != null && yesterdayDay.predictedOccupancy != null
      ? (() => {
          const errorPt = Number(((yesterdayDay.actualOccupancy! - yesterdayDay.predictedOccupancy!) * 100).toFixed(1))
          const actualAdr = yesterdayDay.actualAdr
          return {
            date: yesterdayDay.date,
            predictedOccupancy: yesterdayDay.predictedOccupancy!,
            actualOccupancy: yesterdayDay.actualOccupancy!,
            errorPt,
            actualAdr,
            actualRevPar: actualAdr != null ? Math.round(actualAdr * yesterdayDay.actualOccupancy!) : null,
            comment:
              Math.abs(errorPt) <= 3
                ? "予測はほぼ的中しました。"
                : errorPt > 0
                  ? "実績が予測を上回りました。直前予約の伸びが想定以上でした。"
                  : "実績が予測を下回りました。予約ペース係数の見直し対象です。",
          }
        })()
      : null

  const recentDecisions = Array.from(mockDecisionStore.values()).filter((d) => d.hotelId === hotelId)
  const decided = 12 + recentDecisions.length
  const adopted = 9 + recentDecisions.filter((d) => d.appliedRank === d.recommendedRank).length

  return {
    asOfDate: todayStr,
    totalRooms,
    priorityDays,
    changesSinceYesterday,
    yesterdayReview,
    adoption: { decided, adopted, adoptionRate: decided > 0 ? Number((adopted / decided).toFixed(3)) : null },
  }
}

// 競合ホテル（seedと同等の3社構成）
const MOCK_COMPETITOR_DEFS = [
  { id: "mock-comp-1", name: "コンペティターホテルA", category: "アップスケール", factor: 1.08 },
  { id: "mock-comp-2", name: "コンペティターホテルB", category: "ミッドスケール", factor: 0.94 },
  { id: "mock-comp-3", name: "コンペティターホテルC", category: "アップスケール", factor: 1.02 },
]

function eachMockDate(startDate: string, endDate: string): Date[] {
  const start = new Date(startDate)
  const end = new Date(endDate)
  const dates: Date[] = []
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(new Date(d))
  }
  return dates
}

function mockBookingCurve(hotelId: string, date: string): BookingCurve {
  const stay = new Date(date)
  const totalRooms = MOCK_HOTEL.totalRooms
  const rng = createSeededRandom(stay.getFullYear() * 10000 + (stay.getMonth() + 1) * 100 + stay.getDate())
  const weekend = isMockWeekend(stay)
  const finalOccupancy = Math.min(0.98, (weekend ? 0.92 : 0.74) + (rng() - 0.5) * 0.1)

  // 宿泊日までの日数が減るほど積み上がる（右肩上がり — F-DAILY-01）
  const daysBeforeList = [90, 60, 45, 30, 21, 14, 10, 7, 5, 3, 2, 1, 0]
  const points = daysBeforeList.map((daysBefore) => {
    const progress = Math.pow(1 - daysBefore / 90, 1.6)
    const occupancy = Number((finalOccupancy * progress).toFixed(3))
    return {
      daysBefore,
      roomsBooked: Math.round(totalRooms * occupancy),
      occupancy,
    }
  })

  return { hotelId, stayDate: date, totalRooms, points }
}

function mockCompetitorPrices(hotelId: string, startDate: string, endDate: string): CompetitorPrices {
  const dates = eachMockDate(startDate, endDate)
  const today = new Date()

  const basePrice = (date: Date, rng: () => number) => {
    const weekend = isMockWeekend(date)
    return Math.round((weekend ? 23000 : 16500) * mockSeasonBoost(date.getMonth() + 1) * (0.97 + rng() * 0.08))
  }

  const ownPrices = dates.map((date) => {
    const rng = createSeededRandom(date.getTime() / 86400000)
    return {
      date: toLocalDateStr(date),
      price: basePrice(date, rng),
      isActual: date <= today,
    }
  })

  const competitors = MOCK_COMPETITOR_DEFS.map((comp, ci) => ({
    id: comp.id,
    name: comp.name,
    category: comp.category,
    prices: dates.map((date) => {
      const rng = createSeededRandom(date.getTime() / 86400000 + ci * 977)
      const price1P = Math.round(basePrice(date, rng) * comp.factor)
      return {
        date: toLocalDateStr(date),
        price1P,
        price2P: Math.round(price1P * 1.38),
        price3P: Math.round(price1P * 1.75),
        reliability: rng() > 0.15 ? "HIGH" : "MEDIUM",
      }
    }),
  }))

  return { hotelId, startDate, endDate, ownPrices, competitors }
}

function mockMonthlyTrend(hotelId: string, year: number): MonthlyTrend {
  const today = new Date()
  const totalRooms = MOCK_HOTEL.totalRooms

  const months = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1
    const rng = createSeededRandom(year * 100 + month)
    const boost = mockSeasonBoost(month)
    const days = mockDaysInMonth(year, month)
    const hasActuals = new Date(year, month - 1, 1) <= today

    const occupancy = Number(Math.min(0.97, 0.76 * boost + (rng() - 0.5) * 0.08).toFixed(3))
    const adr = Math.round(18000 * boost * (0.97 + rng() * 0.06))
    const soldRooms = Math.round(totalRooms * days * occupancy)
    const revenue = soldRooms * adr
    const guests = Math.round(soldRooms * 1.5)

    return {
      month,
      revenue: hasActuals ? revenue : 0,
      soldRooms: hasActuals ? soldRooms : 0,
      guests: hasActuals ? guests : 0,
      adr: hasActuals ? adr : null,
      occupancy: hasActuals ? occupancy : null,
      revPar: hasActuals ? Math.round(adr * occupancy) : null,
      budgetRevenue: Math.round(revenue * 0.97),
      lastYearRevenue: Math.round(revenue * 0.93),
      hasActuals,
    }
  })

  return { hotelId, year, months }
}

function mockCompetitorAnalysis(
  hotelId: string,
  startDate: string,
  endDate: string
): CompetitorAnalysis {
  const prices = mockCompetitorPrices(hotelId, startDate, endDate)

  const competitors = prices.competitors.map((comp) => {
    const values = comp.prices
      .map((p) => p.price1P)
      .filter((v): v is number => v != null)
    return {
      id: comp.id,
      name: comp.name,
      category: comp.category,
      sampleSize: values.length,
      minPrice: values.length > 0 ? Math.min(...values) : null,
      maxPrice: values.length > 0 ? Math.max(...values) : null,
      avgPrice:
        values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null,
    }
  })

  return { hotelId, startDate, endDate, competitors }
}

// 料金ランク40段階（F-SET-02）。更新はメモリ上に保持してUI操作を確認できるようにする
let mockPriceRanks: PriceRank[] | null = null

function getMockPriceRanks(hotelId: string): PriceRank[] {
  if (mockPriceRanks) return mockPriceRanks
  mockPriceRanks = Array.from({ length: 40 }, (_, i) => {
    const rank = i + 1
    const price1P = mockRankToPrice1P(rank)
    return {
      id: `mock-rank-${rank}`,
      hotelId,
      rank,
      label: `R${String(rank).padStart(2, "0")}`,
      price1P,
      price2P: Math.round(price1P * 1.4),
      price3P: Math.round(price1P * 1.8),
      price4P: Math.round(price1P * 2.1),
      isActive: true,
    } as PriceRank
  })
  return mockPriceRanks
}

let mockStrategy: PricingStrategy = {
  id: "mock-strategy",
  hotelId: MOCK_HOTEL_ID,
  weightOccupancy: 40,
  weightAdr: 40,
  weightCompetitor: 20,
  minRank: 1,
  maxRank: 40,
  maxDailyRankChange: 3,
  competitorPositionPct: 0,
  autoAdopt: false,
  autoAdoptMinConfidence: 0.7,
  autoAdoptMaxLeadDays: 14,
}

// 会場マスタ（外部要因設計 Phase 2）。更新はメモリ上に保持してUI操作を確認できるようにする
let mockVenues: Venue[] | null = null

function getMockVenues(hotelId: string): Venue[] {
  if (mockVenues) return mockVenues
  mockVenues = [
    {
      id: "mock-venue-1",
      hotelId,
      name: "シティドーム",
      category: "dome",
      address: "東京都文京区後楽1-3",
      latitude: 35.7056,
      longitude: 139.7519,
      capacity: 55000,
      distanceKm: 1.2,
      websiteUrl: "https://example.com/city-dome/events",
      isActive: true,
      estimatedImpact: "high",
      demandPressure: 0.82,
    },
    {
      id: "mock-venue-2",
      hotelId,
      name: "市民文化ホール",
      category: "hall",
      address: "東京都千代田区丸の内3-5",
      latitude: 35.6764,
      longitude: 139.7639,
      capacity: 2000,
      distanceKm: 3.5,
      websiteUrl: null,
      isActive: true,
      estimatedImpact: "low",
      demandPressure: 0.08,
    },
  ]
  return mockVenues
}

/** 会場の収容人数と距離から影響度を簡易推定する（バックエンドの推定ロジックに近い目安値） */
function mockEstimateVenueImpact(capacity: number | null, distanceKm: number | null): {
  estimatedImpact: Venue["estimatedImpact"]
  demandPressure: number | null
} {
  if (capacity == null || capacity <= 0) return { estimatedImpact: null, demandPressure: null }
  const distancePenalty = distanceKm == null ? 0.5 : Math.max(0.1, 1 - distanceKm / 10)
  const pressure = Math.min(1, (capacity / 60000) * distancePenalty)
  const estimatedImpact = pressure >= 0.5 ? "high" : pressure >= 0.2 ? "medium" : "low"
  return { estimatedImpact, demandPressure: Number(pressure.toFixed(2)) }
}

let mockEvents: HotelEvent[] | null = null

function getMockEvents(hotelId: string): HotelEvent[] {
  if (mockEvents) return mockEvents
  const today = new Date()
  const y = today.getFullYear()
  const m = today.getMonth()
  mockEvents = [
    {
      id: "mock-event-1",
      hotelId,
      name: "地域花火大会",
      type: "festival",
      startDate: new Date(y, m, 15),
      endDate: new Date(y, m, 15),
      location: "近隣河川敷",
      expectedImpact: "high",
      description: "周辺ホテルの需要増加が見込まれます。",
      venueId: null,
      venue: null,
      expectedAttendance: null,
      source: "manual",
      status: "confirmed",
      sourceRef: null,
    },
    // 承認待ちの候補（前年実績からの自動検出・会場ページからの抽出）
    {
      id: "mock-candidate-1",
      hotelId,
      name: "前年同時期の需要ピーク",
      type: "other",
      startDate: new Date(y, m, 22),
      endDate: new Date(y, m, 23),
      expectedImpact: "medium",
      description: `前年 ${m + 1}/22〜${m + 1}/23 の稼働率が前後4週平均より +18pt 高く、ADRも +12% でした。イベント要因の可能性があります。`,
      venueId: null,
      venue: null,
      expectedAttendance: null,
      source: "detected",
      status: "candidate",
      sourceRef: `${y - 1}-${String(m + 1).padStart(2, "0")}-22`,
    },
    {
      id: "mock-candidate-2",
      hotelId,
      name: "シティドーム ライブツアー 2DAYS",
      type: "concert",
      startDate: new Date(y, m + 1, 5),
      endDate: new Date(y, m + 1, 6),
      location: "シティドーム",
      expectedImpact: "high",
      description: "会場ページのイベント一覧から抽出しました。2日間開催・全席指定。",
      venueId: "mock-venue-1",
      venue: { id: "mock-venue-1", name: "シティドーム" },
      expectedAttendance: 50000,
      source: "extracted",
      status: "candidate",
      sourceRef: "https://example.com/city-dome/events",
    },
  ]
  return mockEvents
}

function filterMockEventsByStatus(hotelId: string, status: string | undefined): HotelEvent[] {
  const all = getMockEvents(hotelId)
  const wanted = status ?? "confirmed"
  if (wanted === "all") return all
  return all.filter((e) => (e.status ?? "confirmed") === wanted)
}

function mockReviewEventCandidate(id: string, hotelId: string, input: ReviewEventCandidateInput): HotelEvent {
  const target = getMockEvents(hotelId).find((e) => e.id === id && e.status === "candidate")
  if (!target) throw new ApiClientError(404, "イベント候補が見つかりません")
  if (input.decision === "approve") {
    if (input.name) target.name = input.name
    if (input.type) target.type = input.type
    if (input.startDate) target.startDate = new Date(input.startDate)
    if (input.endDate) target.endDate = new Date(input.endDate)
    if (input.expectedImpact) target.expectedImpact = input.expectedImpact
    target.status = "confirmed"
  } else {
    target.status = "rejected"
  }
  return target
}

// 予測モデル比較（外部要因設計 Phase 2）。デモでは ridge-v1 が昇格ゲートを通らない状態を再現する
let mockActiveForecaster: string = "rule-based-v2"
let mockRidgeState: { modelName: string; samples: number; trainedAt: string } | null = null

function mockModelComparison(hotelId: string, startDate?: string, endDate?: string): ModelComparison {
  const today = new Date()
  const end = endDate ?? toLocalDateStr(mockAddDays(today, -1))
  const start = startDate ?? toLocalDateStr(mockAddDays(today, -90))
  const leadDays = [1, 3, 7, 14, 30]
  const buckets = ["0-3日前", "4-7日前", "8-14日前", "15-30日前"]
  const baseline = [4.8, 6.9, 9.4, 12.6]
  const ridge = [4.6, 7.3, 9.9, 13.1]
  const samplesPerBucket = [88, 88, 88, 86]
  const results: BacktestResult[] = [
    {
      modelVersion: "rule-based-v2",
      startDate: start,
      endDate: end,
      leadDays,
      samples: 350,
      beatsBaseline: true,
      summary: buckets.map((bucket, i) => ({
        bucket,
        samples: samplesPerBucket[i],
        mape: baseline[i],
        bias: [0.4, -0.8, -1.5, -2.1][i],
        baselineMape: null,
      })),
    },
    {
      modelVersion: "ridge-v1",
      startDate: start,
      endDate: end,
      leadDays,
      samples: 350,
      beatsBaseline: false,
      summary: buckets.map((bucket, i) => ({
        bucket,
        samples: samplesPerBucket[i],
        mape: ridge[i],
        bias: [0.2, 1.1, 1.9, 2.6][i],
        baselineMape: baseline[i],
      })),
    },
  ]
  const ridgeTrained = mockRidgeState != null
  return {
    hotelId,
    activeForecaster: mockActiveForecaster,
    results,
    promotable: {
      "rule-based-v2": {
        ok: mockActiveForecaster !== "rule-based-v2",
        reason: mockActiveForecaster === "rule-based-v2" ? "現在稼働中のモデルです" : "ルールベースにはいつでも戻せます",
      },
      "ridge-v1": {
        ok: false,
        reason: ridgeTrained
          ? "バックテストでベースライン（rule-based-v2）のMAPEを下回っていません（4-7日前 7.3% vs 6.9%）。学習サンプルを増やして再学習してください"
          : "学習済みモデルがありません。先に「ridge-v1 を学習」を実行してください",
      },
    },
    states: mockRidgeState ? [mockRidgeState] : [],
  }
}

function mockTrainModel(modelName: string): TrainModelResult {
  mockRidgeState = { modelName, samples: 180, trainedAt: new Date().toISOString() }
  return mockRidgeState
}

function mockPromoteModel(hotelId: string, modelName: string, force?: boolean): PromoteModelResult {
  const gate = mockModelComparison(hotelId).promotable[modelName] ?? { ok: false, reason: "不明なモデルです" }
  if (!gate.ok && !force) {
    throw new ApiClientError(400, `モデルを切り替えられません: ${gate.reason}`)
  }
  const before = mockActiveForecaster
  mockActiveForecaster = modelName
  return { before, after: modelName, gate }
}

/** CSV文字列をヘッダー行を除いたセル配列に分解する（デモ取り込み用の簡易パーサ） */
function mockParseCsvRows(csv: string): string[][] {
  return csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(1)
    .map((line) => line.split(",").map((cell) => cell.trim()))
}

function mockImportOtb(input: OtbImportInput): OtbImportResult {
  const skipped: OtbImportResult["skipped"] = []
  let imported = 0
  if (input.rows) {
    imported = input.rows.length
  } else if (input.csv) {
    for (const cells of mockParseCsvRows(input.csv)) {
      const [stayDate, roomsBooked] = cells
      if (!/^\d{4}-\d{2}-\d{2}$/.test(stayDate ?? "")) {
        skipped.push({ stayDate: stayDate ?? "", reason: "宿泊日の形式が不正です（YYYY-MM-DD）" })
        continue
      }
      if (roomsBooked == null || Number.isNaN(Number(roomsBooked))) {
        skipped.push({ stayDate, reason: "予約室数が数値ではありません" })
        continue
      }
      imported += 1
    }
  }
  return { imported, skipped, capturedAt: input.capturedAt ?? new Date().toISOString() }
}

function mockImportCompetitorPrices(input: CompetitorImportInput): CompetitorImportResult {
  const skipped: CompetitorImportResult["skipped"] = []
  const known = new Set(MOCK_COMPETITOR_DEFS.map((c) => c.name))
  const created = new Set<string>()
  let imported = 0
  const names: string[] = []
  if (input.rows) {
    imported = input.rows.length
    for (const r of input.rows) names.push(r.competitorName)
  } else if (input.csv) {
    mockParseCsvRows(input.csv).forEach((cells, index) => {
      const [competitorName, date] = cells
      if (!competitorName) {
        skipped.push({ row: index + 2, reason: "競合名が空です" })
        return
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
        skipped.push({ row: index + 2, reason: "日付の形式が不正です（YYYY-MM-DD）" })
        return
      }
      imported += 1
      names.push(competitorName)
    })
  }
  for (const name of names) {
    if (!known.has(name)) created.add(name)
  }
  return { imported, createdCompetitors: Array.from(created), skipped }
}

// ---- AIチャット・要因評価・知識ベースのモック（デモ表示用） ----

const MOCK_CHAT_TOOLS: ChatTool[] = [
  { name: "get_pricing_overview", description: "指定期間の推奨ランク・需要レベル・稼働率の概況を返す", write: false },
  { name: "explain_recommendation", description: "指定日の推奨ランクの理由分解を返す", write: false },
  { name: "get_daily_digest", description: "今日決めるべき日・昨日の答え合わせ・採用率を返す", write: false },
  { name: "get_factor_scorecard", description: "外部要因・内部要因の評価（アブレーション・成績表）を返す", write: false },
  { name: "search_knowledge", description: "基礎資料（docs/knowledge）を検索して引用する", write: false },
  { name: "register_event", description: "イベントを登録する", write: true },
  { name: "record_decision", description: "推奨の採否を記録する", write: true },
  { name: "adjust_factor", description: "要因の係数を調整し今後90日を再計算する", write: true },
  { name: "ignore_competitor_soldout", description: "競合の満室を需要シグナルから除外する", write: true },
]

const MOCK_CHAT_CITATION: ChatCitation = { id: "pricing-strategy#guardrails", path: "価格戦略とランク運用 › ガードレール" }

const MOCK_KNOWLEDGE_DOCUMENTS: KnowledgeDocument[] = [
  { file: "01-revenue-basics.md", title: "レベニューマネジメントの基礎", sections: 6 },
  { file: "02-pricing-strategy.md", title: "価格戦略とランク運用", sections: 7 },
  { file: "03-demand-factors.md", title: "需要要因と係数の考え方", sections: 8 },
  { file: "04-competitor-analysis.md", title: "競合分析と満室の扱い", sections: 5 },
  { file: "05-operations.md", title: "日次オペレーションと採否記録", sections: 4 },
]

const mockKnowledgeLoadedAt = { value: new Date().toISOString() }

function mockKnowledgeStatus(): KnowledgeStatus {
  return {
    dir: "docs/knowledge",
    loadedAt: mockKnowledgeLoadedAt.value,
    chunks: MOCK_KNOWLEDGE_DOCUMENTS.reduce((sum, d) => sum + d.sections, 0),
    documents: MOCK_KNOWLEDGE_DOCUMENTS,
  }
}

function mockKnowledgeSearch(q: string, k: number): KnowledgeSearchHit[] {
  const hits: KnowledgeSearchHit[] = [
    {
      id: MOCK_CHAT_CITATION.id,
      path: MOCK_CHAT_CITATION.path,
      docTitle: "価格戦略とランク運用",
      heading: "ガードレール",
      text: "推奨ランクは前日比で最大±3段階まで。競合の満室シグナルだけで上限ランクへ一気に上げず、稼働率とOTBの裏付けを確認する。",
      score: 0.82,
    },
    {
      id: "demand-factors#weights",
      path: "需要要因と係数の考え方 › 係数の初期値",
      docTitle: "需要要因と係数の考え方",
      heading: "係数の初期値",
      text: "祝日・連休は +8〜12pt、大型イベントは会場規模と距離に応じて +3〜15pt を初期値とし、成績表で見直す。",
      score: 0.61,
    },
    {
      id: "competitor-analysis#soldout",
      path: "競合分析と満室の扱い › 満室の除外",
      docTitle: "競合分析と満室の扱い",
      heading: "満室の除外",
      text: "改装・団体貸切など需要と無関係な満室は「無視」に設定し、需要シグナルから除外する。",
      score: 0.44,
    },
  ]
  const needle = q.trim()
  const filtered = needle ? hits.filter((h) => h.text.includes(needle) || h.heading.includes(needle) || h.docTitle.includes(needle)) : hits
  return (filtered.length > 0 ? filtered : hits).slice(0, k)
}


// ---- 個社MD モック（メモリ内に1文書。保存でバージョンが上がる） ----

const FACTOR_GROUP_LABELS: Record<FactorGroup, string> = {
  weather: "天候",
  event: "イベント",
  school: "学校休暇",
  holiday: "祝日",
  special: "特別期間",
  comp: "競合",
  weekend: "週末",
}

const MOCK_TENANT_MD_BODY = `# デモホテル東京 個社MD（ヒアリング記入用）

## ホテル概要と客層
東京・品川駅から徒歩5分、客室数120室のビジネスホテル。平日はビジネス客が7割、週末はレジャー客とインバウンド（3割前後）が中心。
繁忙期は3月下旬〜4月上旬（桜）、GW、10〜11月。閑散期は1月中旬〜2月と6月。日曜泊は平日以上に弱い。

## 価格方針
値崩れは最低価格 9,800円 まで。前年同日を大きく下回る価格は原則出さない。
公式サイトはOTA最安値と同額（ベストレート保証）。OTA間で価格差を付けない。

## 需要レベル別の方針
A・Bのときは単価優先。売り切りは前日夕方まで待つ。
D・Eのときは公式サイトの連泊割・早割で需要喚起し、最低価格を割る値下げはしない。

## 繁忙期・団体の扱い
GW・お盆・年末年始は3か月前から段階的に上げ、直前の値下げはしない。
団体は10室以上を個別判断。団体で満室になった日の単価は団体単価で管理する（自動採用しない）。

## 競合の扱い
追従するのは コンペティターホテルA と コンペティターホテルC。
コンペティターホテルB は団体で売止めになることが多く、満室シグナルとして信用しない（除外）。

## 外部要因で効くもの・効かないもの
天候はほぼ効かない（ビジネス客が中心のため）。品川・有明のイベントは大きく効く。学校休暇は週末のみ効く。

## 禁止事項・注意点
前年同日より2段以上下げない。競合の満室だけを理由に上限ランクまで一気に上げない。
2024年の年末に直前値下げで単価を崩した反省があり、12月は直前値下げ禁止。

## ルール
最小ランク: 8
最大ランク: 36
最低価格: 9800
最大変動幅: 3
競合ポジション: +3%
除外競合: コンペティターホテルB
需要レベルA: 下げない。満室が見えたら1段上げる
需要レベルB: 基本は据え置き、ペースが速ければ1段上げる
需要レベルC: 戦略重みどおり
需要レベルD: 最低価格を割らない範囲で1〜2段下げる
需要レベルE: 最低価格を割らない範囲で需要喚起
団体: 10室以上は個別判断（自動採用しない）
効かない要因: 天候
効く要因: イベント
自動採用: オフ
禁止: 前年同日より2段以上下げない
禁止: 競合の満室だけを理由に上限ランクへ一気に上げない
備考: 12月は直前値下げ禁止
`

function emptyHotelRules(): HotelRules {
  return {
    excludedCompetitors: [],
    levelPolicies: {},
    disabledFactorGroups: [],
    enabledFactorGroups: [],
    prohibitions: [],
    notes: [],
  }
}

/** 「## ルール」節を簡易解釈する（バックエンドの解釈器の挙動を模したデモ用） */
function mockParseRules(body: string): RuleParseResult {
  const lines = body.split(/\r?\n/)
  const rules = emptyHotelRules()
  const start = lines.findIndex((l) => l.trim().replace(/\s+/g, "") === "##ルール")
  if (start < 0) return { rules, errors: [], found: false }

  const errors: RuleParseError[] = []
  const factorByLabel = new Map<string, FactorGroup>(
    (Object.entries(FACTOR_GROUP_LABELS) as Array<[FactorGroup, string]>).map(([g, label]) => [label, g])
  )
  const parseInt10 = (value: string): number | null => {
    const n = Number.parseInt(value.replace(/[,，円\s]/g, ""), 10)
    return Number.isFinite(n) ? n : null
  }
  const splitList = (value: string): string[] =>
    value
      .split(/[,、，]/)
      .map((v) => v.trim())
      .filter((v) => v.length > 0)

  let inComment = false
  for (let i = start + 1; i < lines.length; i++) {
    const text = lines[i].trim()
    const line = i + 1
    if (text.startsWith("## ")) break
    if (inComment) {
      if (text.includes("-->")) inComment = false
      continue
    }
    if (text.startsWith("<!--")) {
      if (!text.includes("-->")) inComment = true
      continue
    }
    if (!text) continue

    const m = text.match(/^([^:：]+)[:：]\s*(.*)$/)
    if (!m) {
      errors.push({ line, text, reason: "「キー: 値」の形式ではありません" })
      continue
    }
    const key = m[1].trim()
    const value = m[2].trim()

    if (key === "最小ランク" || key === "最大ランク" || key === "最大変動幅") {
      if (!value) continue
      const n = parseInt10(value)
      if (n == null || n < 1 || (key !== "最大変動幅" && n > 40)) {
        errors.push({ line, text, reason: key === "最大変動幅" ? "1以上の整数で指定してください" : "1〜40の整数で指定してください" })
        continue
      }
      if (key === "最小ランク") rules.minRank = n
      else if (key === "最大ランク") rules.maxRank = n
      else rules.maxDailyRankChange = n
    } else if (key === "最低価格") {
      if (!value) continue
      const n = parseInt10(value)
      if (n == null || n < 0) {
        errors.push({ line, text, reason: "円の整数で指定してください" })
        continue
      }
      rules.minPrice = n
    } else if (key === "競合ポジション") {
      if (!value) continue
      const pm = value.match(/^([+\-−±]?)\s*(\d+(?:\.\d+)?)\s*%?$/)
      if (!pm) {
        errors.push({ line, text, reason: "「+5%」のように % で指定してください" })
        continue
      }
      const sign = pm[1] === "-" || pm[1] === "−" ? -1 : 1
      rules.competitorPositionPct = sign * Number(pm[2])
    } else if (key === "除外競合") {
      rules.excludedCompetitors.push(...splitList(value))
    } else if (/^需要レベル[A-E]$/.test(key)) {
      const level = key.slice(-1) as DemandLevel
      if (value) rules.levelPolicies[level] = value
    } else if (key === "団体") {
      if (value) rules.groupPolicy = value
    } else if (key === "効かない要因" || key === "効く要因") {
      const groups: FactorGroup[] = []
      let bad: string | null = null
      for (const label of splitList(value)) {
        const g = factorByLabel.get(label)
        if (!g) {
          bad = label
          break
        }
        groups.push(g)
      }
      if (bad != null) {
        errors.push({
          line,
          text,
          reason: `「${bad}」は要因名ではありません（${Object.values(FACTOR_GROUP_LABELS).join(", ")} から選んでください）`,
        })
        continue
      }
      if (key === "効かない要因") rules.disabledFactorGroups.push(...groups)
      else rules.enabledFactorGroups.push(...groups)
    } else if (key === "自動採用") {
      if (!value) continue
      if (/^(オン|on|ON|有効|true)$/i.test(value)) rules.autoAdopt = true
      else if (/^(オフ|off|OFF|無効|false)$/i.test(value)) rules.autoAdopt = false
      else errors.push({ line, text, reason: "オン / オフ で指定してください" })
    } else if (key === "禁止") {
      if (value) rules.prohibitions.push(value)
    } else if (key === "備考") {
      if (value) rules.notes.push(value)
    } else {
      errors.push({ line, text, reason: `「${key}」はルール節で使えないキーです` })
    }
  }

  if (rules.minRank != null && rules.maxRank != null && rules.minRank > rules.maxRank) {
    errors.push({ line: start + 1, text: "## ルール", reason: "最小ランクが最大ランクを上回っています" })
  }
  return { rules, errors, found: true }
}

function mockApplyRules(hotelId: string | null, rules: HotelRules): ApplyRulesResult {
  const strategyUpdates: Record<string, unknown> = {}
  if (rules.minRank != null) strategyUpdates.minRank = rules.minRank
  if (rules.maxRank != null) strategyUpdates.maxRank = rules.maxRank
  if (rules.minPrice != null) strategyUpdates.minPrice = rules.minPrice
  if (rules.maxDailyRankChange != null) strategyUpdates.maxDailyRankChange = rules.maxDailyRankChange
  if (rules.competitorPositionPct != null) strategyUpdates.competitorPositionPct = rules.competitorPositionPct
  if (rules.autoAdopt != null) strategyUpdates.autoAdopt = rules.autoAdopt

  const excludedCompetitors: string[] = []
  const competitorsNotFound: string[] = []
  for (const name of rules.excludedCompetitors) {
    const hit = MOCK_COMPETITOR_DEFS.find((c) => c.name.includes(name))
    if (hit) excludedCompetitors.push(hit.name)
    else competitorsNotFound.push(name)
  }
  return {
    hotelIds: [hotelId ?? MOCK_HOTEL_ID],
    strategyUpdates,
    excludedCompetitors,
    competitorsNotFound,
    lockedFactorKeys: rules.disabledFactorGroups.map((g) => `${g}.*`),
    unlockedFactorKeys: rules.enabledFactorGroups.map((g) => `${g}.*`),
    recomputedDays: 91,
  }
}

const mockTenantDocuments: KnowledgeDocumentDetail[] = (() => {
  const parsed = mockParseRules(MOCK_TENANT_MD_BODY)
  const createdAt = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const updatedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
  return [
    {
      id: "mock-tenant-doc-1",
      tenantId: MOCK_TENANT_ID,
      hotelId: MOCK_HOTEL_ID,
      title: "デモホテル東京 個社MD",
      version: 2,
      body: MOCK_TENANT_MD_BODY,
      rules: parsed.rules,
      rulesErrors: parsed.errors,
      rulesAppliedAt: updatedAt,
      isActive: true,
      createdAt,
      updatedAt,
      updatedByUserId: "mock-manager",
      revisions: [
        { version: 2, createdAt: updatedAt, createdByUserId: "mock-manager" },
        { version: 1, createdAt, createdByUserId: "mock-admin" },
      ],
    },
  ]
})()

let mockTenantDocumentSeq = 1

function toKnowledgeDocumentSummary(doc: KnowledgeDocumentDetail): KnowledgeDocumentSummary {
  const { tenantId: _tenantId, body: _body, createdAt: _createdAt, revisions: _revisions, ...summary } = doc
  return summary
}

function mockSaveKnowledgeDocument(existing: KnowledgeDocumentDetail | null, input: SaveKnowledgeDocumentInput): SavedKnowledgeDocument {
  const parsed = mockParseRules(input.body)
  const now = new Date().toISOString()
  const hotelId = input.tenantWide ? null : input.hotelId
  const canApply = parsed.found && parsed.errors.length === 0
  const applied = canApply ? mockApplyRules(hotelId, parsed.rules) : null

  let doc: KnowledgeDocumentDetail
  if (existing) {
    existing.title = input.title
    existing.body = input.body
    existing.hotelId = hotelId
    existing.version += 1
    existing.rules = parsed.found ? parsed.rules : null
    existing.rulesErrors = parsed.errors
    existing.rulesAppliedAt = canApply ? now : existing.rulesAppliedAt
    existing.updatedAt = now
    existing.updatedByUserId = getMockUser()?.id ?? null
    existing.revisions.unshift({ version: existing.version, createdAt: now, createdByUserId: existing.updatedByUserId })
    doc = existing
  } else {
    mockTenantDocumentSeq += 1
    doc = {
      id: `mock-tenant-doc-${mockTenantDocumentSeq}`,
      tenantId: MOCK_TENANT_ID,
      hotelId,
      title: input.title,
      version: 1,
      body: input.body,
      rules: parsed.found ? parsed.rules : null,
      rulesErrors: parsed.errors,
      rulesAppliedAt: canApply ? now : null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      updatedByUserId: getMockUser()?.id ?? null,
      revisions: [{ version: 1, createdAt: now, createdByUserId: getMockUser()?.id ?? null }],
    }
    mockTenantDocuments.unshift(doc)
  }

  const message = !parsed.found
    ? "個社MDを保存しました（「## ルール」節がないため、ルールは反映していません）"
    : parsed.errors.length > 0
      ? `個社MDを保存しました。解釈できない行が ${parsed.errors.length} 件あるため、ルールは反映していません`
      : `個社MDを保存し、ルールを反映しました（${applied?.recomputedDays ?? 0}日を再計算）`

  return {
    document: {
      id: doc.id,
      tenantId: doc.tenantId,
      hotelId: doc.hotelId,
      title: doc.title,
      version: doc.version,
      rules: doc.rules,
      rulesErrors: doc.rulesErrors ?? [],
      rulesAppliedAt: doc.rulesAppliedAt,
      updatedAt: doc.updatedAt,
    },
    applied,
    rulesFound: parsed.found,
    message,
  }
}

function findMockTenantDocument(id: string): KnowledgeDocumentDetail {
  const doc = mockTenantDocuments.find((d) => d.id === id)
  if (!doc) throw new ApiClientError(404, "個社MDが見つかりません")
  return doc
}

const mockConversations: ChatConversation[] = []

function mockChatReply(input: SendChatMessageInput): ChatReply {
  const now = new Date().toISOString()
  let conversation = input.conversationId ? mockConversations.find((c) => c.id === input.conversationId) : undefined
  if (!conversation) {
    conversation = {
      id: `mock-conv-${Date.now()}`,
      title: input.content.slice(0, 30),
      userId: getMockUser()?.id ?? "mock-user",
      createdAt: now,
      updatedAt: now,
      messages: [],
    }
    mockConversations.unshift(conversation)
  }
  conversation.messages.push({
    id: `mock-msg-${Date.now()}-u`,
    role: "user",
    content: input.content,
    citations: null,
    actions: null,
    llmProvider: null,
    llmModel: null,
    createdAt: now,
  })

  const wantsRegister = input.content.includes("登録")
  const actions: ChatAction[] = wantsRegister
    ? [
        {
          tool: "register_event",
          input: { name: "デモイベント", date: toLocalDateStr(mockAddDays(new Date(), 14)) },
          ok: true,
          summary: `イベント「デモイベント」を ${toLocalDateStr(mockAddDays(new Date(), 14))} に登録しました（デモ）`,
        },
      ]
    : []
  const content = wantsRegister
    ? "ご依頼の内容をイベントとして登録しました。\n登録したイベントは需要レベルの算出に反映され、推奨ランクが次回の再計算で更新されます。\n\n" +
      "なお、ガードレールにより推奨ランクの変動は前日比 ±3段階までに抑えられます。"
    : "直近の推奨ランクは、週末（金・土）の需要レベル A〜B を根拠に上位ランクを提案しています。\n" +
      "競合の満室シグナルだけで上限ランクへは上げず、稼働率とOTB（予約残）の裏付けを確認したうえで決めています。\n\n" +
      "詳しい根拠は基礎資料「価格戦略とランク運用 › ガードレール」を参照してください。"
  const llm = getMockLlmOptions().effective
  const message: ChatReplyMessage = {
    id: `mock-msg-${Date.now()}-a`,
    role: "assistant",
    content,
    citations: [MOCK_CHAT_CITATION],
    actions,
    llmProvider: input.llmProvider ?? llm?.provider ?? "anthropic",
    llmModel: input.llmModel ?? llm?.model ?? "mock-model",
    createdAt: now,
  }
  conversation.messages.push({ ...message })
  conversation.updatedAt = now
  return {
    conversationId: conversation.id,
    message,
    toolsUsed: wantsRegister ? ["search_knowledge", "register_event"] : ["explain_recommendation", "search_knowledge"],
  }
}

function mockFactorEvaluation(hotelId: string, lookbackDays: number): FactorEvaluation {
  return {
    hotelId,
    lookbackDays,
    samples: Math.min(lookbackDays, 180),
    ablation: [
      // MAPE は割合（0.084 = 8.4%）。contribution = mapeWithout − mapeWith（正なら要因が精度に貢献）
      { group: "holiday", label: "祝日・連休", activeDays: Math.round(lookbackDays * 0.14), mapeWith: 0.084, mapeWithout: 0.109, contribution: 0.025 },
      { group: "event", label: "イベント", activeDays: Math.round(lookbackDays * 0.08), mapeWith: 0.084, mapeWithout: 0.096, contribution: 0.012 },
      { group: "weather", label: "天候", activeDays: Math.round(lookbackDays * 0.22), mapeWith: 0.084, mapeWithout: 0.081, contribution: -0.003 },
      { group: "competitor", label: "競合満室", activeDays: Math.round(lookbackDays * 0.05), mapeWith: 0.084, mapeWithout: 0.087, contribution: 0.003 },
      { group: "schoolBreak", label: "学校休暇", activeDays: 0, mapeWith: 0.084, mapeWithout: 0.084, contribution: 0 },
    ],
    scorecard: [
      { key: "holiday.publicHoliday", label: "祝日", group: "holiday", samples: 11, assumedPt: 10, meanResidualPt: 3.2, positiveShare: 0.73, verdict: "過小評価" },
      { key: "holiday.longWeekend", label: "連休", group: "holiday", samples: 6, assumedPt: 12, meanResidualPt: 0.8, positiveShare: 0.5, verdict: "妥当" },
      { key: "event.large", label: "大型イベント", group: "event", samples: 4, assumedPt: 15, meanResidualPt: -6.1, positiveShare: 0.25, verdict: "過大評価" },
      { key: "weather.rain", label: "雨天", group: "weather", samples: 19, assumedPt: -4, meanResidualPt: -0.4, positiveShare: 0.47, verdict: "妥当" },
      { key: "competitor.soldOut", label: "競合満室", group: "competitor", samples: 2, assumedPt: 5, meanResidualPt: 1.5, positiveShare: 0.5, verdict: "データ不足" },
    ],
  }
}

function mockRecommendationEffect(hotelId: string, lookbackDays: number): RecommendationEffect {
  const row = (
    demandLevel: string,
    adopted: [number, number, number, number],
    overridden: [number, number, number, number],
    none: [number, number, number, number]
  ): EffectRow => {
    const stats = ([days, revPar, occ, adr]: [number, number, number, number]): EffectGroupStats => ({
      days,
      avgRevPar: days > 0 ? revPar : null,
      avgOccupancy: days > 0 ? occ : null,
      avgAdr: days > 0 ? adr : null,
    })
    const a = stats(adopted)
    const o = stats(overridden)
    return {
      demandLevel,
      adopted: a,
      overridden: o,
      none: stats(none),
      revParDiffAdoptedVsOverridden: a.avgRevPar != null && o.avgRevPar != null ? Math.round(a.avgRevPar - o.avgRevPar) : null,
    }
  }
  const rows = [
    row("A", [9, 21800, 94.2, 23100], [4, 20400, 95.0, 21500], [3, 20900, 93.1, 22400]),
    row("B", [14, 17600, 88.5, 19900], [6, 16900, 90.1, 18800], [5, 17100, 87.9, 19400]),
    row("C", [18, 13900, 80.2, 17300], [5, 13700, 82.0, 16700], [9, 13500, 79.5, 17000]),
    row("D", [11, 10800, 71.4, 15100], [3, 11200, 74.0, 15100], [6, 10500, 70.2, 15000]),
    row("E", [4, 8100, 60.5, 13400], [0, 0, 0, 0], [3, 7900, 59.8, 13200]),
  ]
  return {
    hotelId,
    lookbackDays,
    samples: rows.reduce((sum, r) => sum + r.adopted.days + r.overridden.days + r.none.days, 0),
    rows,
    overall: row("all", [56, 15200, 80.9, 18100], [18, 15600, 84.1, 17600], [26, 14400, 79.3, 17800]),
    caveat:
      "採用日と上書き日は需要レベルや曜日構成が異なるため、差は推奨の因果効果ではなく参考値です。上書きは需要が想定と異なった日に偏りやすい点に注意してください。",
  }
}

// ---- API surface ----

export const api = {
  async login(email: string, password: string): Promise<LoginResult> {
    try {
      const result = await rawRequest<LoginResult>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      })
      storeTokens(result.tokens.accessToken, result.tokens.refreshToken)
      return result
    } catch (err) {
      if (isDemoModeEnabled() && err instanceof ApiClientError && err.isBackendUnreachable) {
        markDemoDataInUse()
        const result = mockLogin(email, password)
        storeTokens(result.tokens.accessToken, result.tokens.refreshToken)
        storeMockUser(result.user)
        return result
      }
      throw err
    }
  },

  async logout(): Promise<void> {
    const refreshToken = getRefreshToken()
    if (refreshToken && !getMockUser()) {
      try {
        await rawRequest("/api/v1/auth/logout", {
          method: "POST",
          body: JSON.stringify({ refreshToken }),
        })
      } catch {
        // トークン失効済みでもローカルは消す
      }
    }
    clearTokens()
  },

  me(): Promise<User & { hotel?: Hotel | null }> {
    if (isDemoModeEnabled()) {
      const mockUser = getMockUser()
      if (mockUser) return Promise.resolve({ ...mockUser, hotel: MOCK_HOTEL })
    }
    return rawRequest("/api/v1/auth/me")
  },

  hotels(): Promise<Hotel[]> {
    return withDemoFallback(
      () => rawRequest("/api/v1/hotels"),
      () => [MOCK_HOTEL]
    )
  },

  dashboardKpi(hotelId: string, year: number, month: number): Promise<DashboardKpi> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/dashboard/kpi?hotelId=${hotelId}&year=${year}&month=${month}`),
      () => mockDashboardKpi(hotelId, year, month)
    )
  },

  /** minLevel を指定するとその重要度以上のみ取得（ダッシュボードは4＝Level 5・4のみ） */
  alerts(hotelId: string, minLevel?: number): Promise<AlertItem[]> {
    const levelParam = minLevel != null ? `&minLevel=${minLevel}` : ""
    return withDemoFallback(
      () => rawRequest(`/api/v1/dashboard/alerts?hotelId=${hotelId}${levelParam}`),
      () => mockAlerts(minLevel)
    )
  },

  aiSummary(hotelId: string, section?: string): Promise<AiSummary | null> {
    const sectionParam = section ? `&section=${encodeURIComponent(section)}` : ""
    return withDemoFallback(
      () => rawRequest(`/api/v1/dashboard/ai-summary?hotelId=${hotelId}${sectionParam}`),
      () => mockAiSummary(section)
    )
  },

  pricingCalendar(hotelId: string, year: number, month: number): Promise<PricingCalendar> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/pricing/calendar?hotelId=${hotelId}&year=${year}&month=${month}`),
      () => mockPricingCalendar(hotelId, year, month)
    )
  },

  pricingStrategy(hotelId: string): Promise<PricingStrategy> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/pricing/strategy?hotelId=${hotelId}`),
      () => ({ ...mockStrategy, hotelId })
    )
  },

  /** 重み（合計100%）とガードレール（任意）を更新する。MANAGER以上 */
  updatePricingStrategy(hotelId: string, input: UpdatePricingStrategyInput): Promise<PricingStrategy> {
    return withDemoFallback(
      () =>
        rawRequest("/api/v1/pricing/strategy", {
          method: "PUT",
          body: JSON.stringify({ hotelId, ...input }),
        }),
      () => {
        mockStrategy = { ...mockStrategy, hotelId, ...input }
        return mockStrategy
      }
    )
  },

  /** 今日決めるべき日・昨日からの変化・答え合わせ・採用率のダイジェスト */
  pricingDigest(hotelId: string): Promise<PricingDigest> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/pricing/digest?hotelId=${hotelId}`),
      () => mockPricingDigest(hotelId)
    )
  },

  /** 推奨ランクの採否を記録する（MANAGER以上） */
  recordDecision(input: RecordDecisionInput): Promise<RecommendationDecision> {
    return withDemoFallback(
      () =>
        rawRequest("/api/v1/pricing/decisions", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      () => mockRecordDecision(input)
    )
  },

  decisions(hotelId: string, startDate: string, endDate: string): Promise<RecommendationDecision[]> {
    return withDemoFallback(
      () =>
        rawRequest(
          `/api/v1/pricing/decisions?hotelId=${hotelId}&startDate=${startDate}&endDate=${endDate}`
        ),
      () => getMockDecisions(hotelId, startDate, endDate)
    )
  },

  /** 日別の外部シグナル（祝日・連休・天候） */
  signals(hotelId: string, startDate: string, endDate: string): Promise<DailySignal[]> {
    return withDemoFallback(
      () =>
        rawRequest(`/api/v1/pricing/signals?hotelId=${hotelId}&startDate=${startDate}&endDate=${endDate}`),
      () => mockSignals(startDate, endDate)
    )
  },

  /** 気象庁・Open-Meteo から天候予報を取り込む（MANAGER以上） */
  ingestSignals(hotelId: string): Promise<SignalsIngestResult> {
    return withDemoFallback(
      () =>
        rawRequest("/api/v1/pricing/signals/ingest", {
          method: "POST",
          body: JSON.stringify({ hotelId }),
        }),
      () => mockIngestSignals(hotelId)
    )
  },

  bookingCurve(hotelId: string, date: string): Promise<BookingCurve> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/daily/booking-curve?hotelId=${hotelId}&date=${date}`),
      () => mockBookingCurve(hotelId, date)
    )
  },

  competitorPrices(hotelId: string, startDate: string, endDate: string): Promise<CompetitorPrices> {
    return withDemoFallback(
      () =>
        rawRequest(
          `/api/v1/daily/competitor-prices?hotelId=${hotelId}&startDate=${startDate}&endDate=${endDate}`
        ),
      () => mockCompetitorPrices(hotelId, startDate, endDate)
    )
  },

  monthlyTrend(hotelId: string, year: number): Promise<MonthlyTrend> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/analysis/monthly?hotelId=${hotelId}&year=${year}`),
      () => mockMonthlyTrend(hotelId, year)
    )
  },

  competitorAnalysis(hotelId: string, startDate: string, endDate: string): Promise<CompetitorAnalysis> {
    return withDemoFallback(
      () =>
        rawRequest(
          `/api/v1/analysis/competitor?hotelId=${hotelId}&startDate=${startDate}&endDate=${endDate}`
        ),
      () => mockCompetitorAnalysis(hotelId, startDate, endDate)
    )
  },

  priceRanks(hotelId: string): Promise<PriceRank[]> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/settings/price-ranks?hotelId=${hotelId}`),
      () => getMockPriceRanks(hotelId)
    )
  },

  updatePriceRank(
    id: string,
    hotelId: string,
    data: Partial<{ label: string; price1P: number; price2P: number; price3P: number; price4P: number }>
  ): Promise<PriceRank> {
    return withDemoFallback(
      () =>
        rawRequest<PriceRank>(`/api/v1/settings/price-ranks/${id}?hotelId=${hotelId}`, {
          method: "PUT",
          body: JSON.stringify(data),
        }),
      () => {
        // デモ時はメモリ上のランクを書き換えて、保存操作の結果を画面で確認できるようにする
        const ranks = getMockPriceRanks(hotelId)
        const target = ranks.find((r) => r.id === id)
        if (!target) throw new ApiClientError(404, "料金ランクが見つかりません")
        Object.assign(target, data)
        return target
      }
    )
  },

  updateHotelSettings(hotelId: string, data: UpdateHotelSettingsInput): Promise<Hotel> {
    return withDemoFallback(
      () =>
        rawRequest<Hotel>(`/api/v1/settings/hotel/${hotelId}`, {
          method: "PUT",
          body: JSON.stringify(data),
        }),
      () => {
        // デモ時はメモリ上のホテル設定を書き換えて保存操作を確認できるようにする
        Object.assign(MOCK_HOTEL, data, { updatedAt: new Date() })
        return MOCK_HOTEL
      }
    )
  },

  /** AIモデル（LLM）の選択肢と、このホテルで実際に使われる選択 */
  llmOptions(hotelId: string): Promise<LlmOptions> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/settings/llm?hotelId=${hotelId}`),
      () => getMockLlmOptions()
    )
  },

  /** イベント一覧。status 省略時は confirmed のみ（candidate / rejected / all を指定可） */
  events(
    hotelId: string,
    startDate?: string,
    endDate?: string,
    status?: "confirmed" | "candidate" | "rejected" | "all"
  ): Promise<HotelEvent[]> {
    const params = new URLSearchParams({ hotelId })
    if (startDate) params.set("startDate", startDate)
    if (endDate) params.set("endDate", endDate)
    if (status) params.set("status", status)
    return withDemoFallback(
      () => rawRequest(`/api/v1/events?${params.toString()}`),
      () => filterMockEventsByStatus(hotelId, status)
    )
  },

  createEvent(input: CreateEventInput): Promise<HotelEvent> {
    return withDemoFallback(
      () =>
        rawRequest("/api/v1/events", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      () => {
        const venue = input.venueId ? getMockVenues(input.hotelId).find((v) => v.id === input.venueId) ?? null : null
        const newEvent: HotelEvent = {
          id: `mock-event-${Date.now()}`,
          hotelId: input.hotelId,
          name: input.name,
          type: input.type,
          startDate: new Date(input.startDate),
          endDate: new Date(input.endDate),
          location: input.location ?? venue?.name,
          // 影響度が未指定で会場が選ばれていれば会場から推定する（バックエンドと同じ挙動）
          expectedImpact: input.expectedImpact ?? venue?.estimatedImpact ?? undefined,
          description: input.description,
          venueId: venue?.id ?? null,
          venue: venue ? { id: venue.id, name: venue.name } : null,
          expectedAttendance: input.expectedAttendance ?? null,
          source: "manual",
          status: "confirmed",
          sourceRef: null,
        }
        getMockEvents(input.hotelId).push(newEvent)
        return newEvent
      }
    )
  },

  // ---- 会場マスタ・イベント候補（外部要因設計 Phase 2） ----

  venues(hotelId: string): Promise<Venue[]> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/events/venues?hotelId=${hotelId}`),
      () => getMockVenues(hotelId)
    )
  },

  /** 会場を登録する（MANAGER以上） */
  createVenue(input: CreateVenueInput): Promise<Venue> {
    return withDemoFallback(
      () =>
        rawRequest("/api/v1/events/venues", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      () => {
        const venue: Venue = {
          id: `mock-venue-${Date.now()}`,
          hotelId: input.hotelId,
          name: input.name,
          category: input.category ?? null,
          address: input.address ?? null,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          capacity: input.capacity ?? null,
          distanceKm: input.distanceKm ?? null,
          websiteUrl: input.websiteUrl ?? null,
          isActive: true,
          ...mockEstimateVenueImpact(input.capacity ?? null, input.distanceKm ?? null),
        }
        getMockVenues(input.hotelId).push(venue)
        return venue
      }
    )
  },

  /** 会場を更新する（MANAGER以上） */
  updateVenue(id: string, hotelId: string, input: UpdateVenueInput): Promise<Venue> {
    return withDemoFallback(
      () =>
        rawRequest(`/api/v1/events/venues/${id}?hotelId=${hotelId}`, {
          method: "PUT",
          body: JSON.stringify(input),
        }),
      () => {
        const target = getMockVenues(hotelId).find((v) => v.id === id)
        if (!target) throw new ApiClientError(404, "会場が見つかりません")
        Object.assign(target, input)
        Object.assign(target, mockEstimateVenueImpact(target.capacity, target.distanceKm))
        return target
      }
    )
  },

  /** 会場を削除する（MANAGER以上） */
  deleteVenue(id: string, hotelId: string): Promise<void> {
    return withDemoFallback(
      () =>
        rawRequest(`/api/v1/events/venues/${id}?hotelId=${hotelId}`, {
          method: "DELETE",
        }),
      () => {
        mockVenues = getMockVenues(hotelId).filter((v) => v.id !== id)
      }
    )
  },

  /**
   * 会場の公式ページからイベントを抽出し候補として登録する（MANAGER以上）。
   * APIキー未設定・websiteUrl 未登録の場合は 400 で日本語メッセージが返る。
   * options で今回の実行だけLLMプロバイダ／モデルを上書きできる
   */
  extractVenueEvents(id: string, hotelId: string, options: VenueExtractOptions = {}): Promise<VenueExtractResult> {
    return withDemoFallback(
      () =>
        rawRequest(`/api/v1/events/venues/${id}/extract`, {
          method: "POST",
          body: JSON.stringify({
            hotelId,
            ...(options.llmProvider != null ? { llmProvider: options.llmProvider } : {}),
            ...(options.llmModel != null && options.llmModel !== "" ? { llmModel: options.llmModel } : {}),
          }),
        }),
      () => {
        const venue = getMockVenues(hotelId).find((v) => v.id === id)
        if (!venue) throw new ApiClientError(404, "会場が見つかりません")
        if (!venue.websiteUrl) throw new ApiClientError(400, "この会場には公式ページURLが登録されていません")
        const existing = getMockEvents(hotelId).filter((e) => e.venueId === id && e.source === "extracted")
        // デモでは既存の抽出済み候補を重複扱いにし、新規作成はしない
        return {
          venueId: id,
          venueName: venue.name,
          url: venue.websiteUrl,
          truncated: false,
          extracted: existing.length,
          created: 0,
          skippedDuplicates: existing.length,
          notes: "デモデータのため新規のイベントは作成していません。",
          llm: getMockLlmOptions().effective,
        }
      }
    )
  },

  /** 承認待ちのイベント候補 */
  eventCandidates(hotelId: string): Promise<EventCandidate[]> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/events/candidates?hotelId=${hotelId}`),
      () => filterMockEventsByStatus(hotelId, "candidate")
    )
  },

  /** 前年の実績（稼働率・ADRの突出日）からイベント候補を検出する（MANAGER以上） */
  detectEventCandidates(hotelId: string, lookbackDays?: number): Promise<DetectCandidatesResult> {
    return withDemoFallback(
      () =>
        rawRequest("/api/v1/events/candidates/detect", {
          method: "POST",
          body: JSON.stringify({ hotelId, ...(lookbackDays != null && { lookbackDays }) }),
        }),
      () => {
        const existing = filterMockEventsByStatus(hotelId, "candidate").filter((e) => e.source === "detected").length
        return { analyzedDays: lookbackDays ?? 365, candidates: existing, created: 0, skippedExisting: existing }
      }
    )
  },

  /** イベント候補を承認（内容の上書き可）または却下する（MANAGER以上） */
  reviewEventCandidate(id: string, hotelId: string, input: ReviewEventCandidateInput): Promise<HotelEvent> {
    return withDemoFallback(
      () =>
        rawRequest(`/api/v1/events/candidates/${id}/review`, {
          method: "POST",
          body: JSON.stringify({ hotelId, ...input }),
        }),
      () => mockReviewEventCandidate(id, hotelId, input)
    )
  },

  // ---- データ取り込み（PMS OTB / 競合価格 — コネクタ設定までの手動経路。MANAGER以上） ----

  importOtb(hotelId: string, input: OtbImportInput): Promise<OtbImportResult> {
    return withDemoFallback(
      () =>
        rawRequest("/api/v1/integrations/otb", {
          method: "POST",
          body: JSON.stringify({ hotelId, ...input }),
        }),
      () => mockImportOtb(input)
    )
  },

  importCompetitorPrices(hotelId: string, input: CompetitorImportInput): Promise<CompetitorImportResult> {
    return withDemoFallback(
      () =>
        rawRequest("/api/v1/integrations/competitor-prices", {
          method: "POST",
          body: JSON.stringify({ hotelId, ...input }),
        }),
      () => mockImportCompetitorPrices(input)
    )
  },

  // ---- 予測モデル（バックテスト比較・学習・切り替え） ----

  /** バックテストを実行してモデルを比較する。数秒かかるため画面ではボタン押下時のみ呼ぶ */
  compareModels(hotelId: string, startDate?: string, endDate?: string): Promise<ModelComparison> {
    const params = new URLSearchParams({ hotelId })
    if (startDate) params.set("startDate", startDate)
    if (endDate) params.set("endDate", endDate)
    return withDemoFallback(
      () => rawRequest(`/api/v1/pricing/models?${params.toString()}`),
      () => mockModelComparison(hotelId, startDate, endDate)
    )
  },

  /** 学習モデルを再学習する（MANAGER以上） */
  trainModel(hotelId: string, modelName: ForecasterModelName = "ridge-v1"): Promise<TrainModelResult> {
    return withDemoFallback(
      () =>
        rawRequest("/api/v1/pricing/models/train", {
          method: "POST",
          body: JSON.stringify({ hotelId, modelName }),
        }),
      () => mockTrainModel(modelName)
    )
  },

  /** 稼働モデルを切り替える（ADMINのみ）。ゲート不通過時は 400 で理由が返る。force=true で強制 */
  promoteModel(hotelId: string, modelName: ForecasterModelName, force?: boolean): Promise<PromoteModelResult> {
    return withDemoFallback(
      () =>
        rawRequest("/api/v1/pricing/models/promote", {
          method: "POST",
          body: JSON.stringify({ hotelId, modelName, ...(force && { force: true }) }),
        }),
      () => mockPromoteModel(hotelId, modelName, force)
    )
  },

  updateEvent(id: string, hotelId: string, input: UpdateEventInput): Promise<HotelEvent> {
    return rawRequest(`/api/v1/events/${id}?hotelId=${hotelId}`, {
      method: "PUT",
      body: JSON.stringify(input),
    })
  },

  deleteEvent(id: string, hotelId: string): Promise<void> {
    return withDemoFallback(
      () =>
        rawRequest(`/api/v1/events/${id}?hotelId=${hotelId}`, {
          method: "DELETE",
        }),
      () => {
        mockEvents = getMockEvents(hotelId).filter((e) => e.id !== id)
      }
    )
  },

  // ---- AIチャット（会話から推奨の説明・要因評価・基礎資料の引用・設定変更） ----

  /**
   * チャットに発言を送りアシスタントの返答を得る。
   * LLM APIキー未設定時は 400 で日本語メッセージが返るため、そのまま画面に表示する（サイレントに代替しない）
   */
  sendChatMessage(input: SendChatMessageInput): Promise<ChatReply> {
    return withDemoFallback(
      () =>
        rawRequest("/api/v1/chat/messages", {
          method: "POST",
          body: JSON.stringify({
            hotelId: input.hotelId,
            content: input.content,
            ...(input.conversationId ? { conversationId: input.conversationId } : {}),
            ...(input.llmProvider != null ? { llmProvider: input.llmProvider } : {}),
            ...(input.llmModel != null && input.llmModel !== "" ? { llmModel: input.llmModel } : {}),
          }),
        }),
      () => mockChatReply(input)
    )
  },

  /** 会話一覧（新しい順） */
  chatConversations(hotelId: string): Promise<ChatConversationSummary[]> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/chat/conversations?hotelId=${hotelId}`),
      () => mockConversations.map(({ messages: _messages, ...summary }) => summary)
    )
  },

  /** 過去の会話（メッセージ込み） */
  chatConversation(id: string, hotelId: string): Promise<ChatConversation> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/chat/conversations/${id}?hotelId=${hotelId}`),
      () => {
        const found = mockConversations.find((c) => c.id === id)
        if (!found) throw new ApiClientError(404, "会話が見つかりません")
        return found
      }
    )
  },

  /** このユーザーのロールでチャットから実行できるツール */
  chatTools(): Promise<ChatTool[]> {
    return withDemoFallback(
      () => rawRequest("/api/v1/chat/tools"),
      () => {
        const role = getMockUser()?.role
        const canWrite = role === "ADMIN" || role === "MANAGER"
        return MOCK_CHAT_TOOLS.filter((t) => canWrite || !t.write)
      }
    )
  },

  /** AIまとめを生成する（MANAGER以上）。APIキー未設定時は 400 で日本語メッセージが返る */
  generateAiSummary(hotelId: string, options: GenerateAiSummaryOptions = {}): Promise<AiSummary> {
    return withDemoFallback(
      () =>
        rawRequest("/api/v1/dashboard/ai-summary/generate", {
          method: "POST",
          body: JSON.stringify({
            hotelId,
            ...(options.section ? { section: options.section } : {}),
            ...(options.llmProvider != null ? { llmProvider: options.llmProvider } : {}),
            ...(options.llmModel != null && options.llmModel !== "" ? { llmModel: options.llmModel } : {}),
          }),
        }),
      () => {
        const llm = getMockLlmOptions().effective
        return {
          ...mockAiSummary(options.section),
          id: `mock-ai-summary-${Date.now()}`,
          hotelId,
          modelVersion: llm ? `${llm.provider}/${llm.model}` : "mock-model",
          content:
            "【注目】週末（金・土）の稼働率が 95% 前後で推移し、ADR も前年比 +6% と好調です。\n" +
            "【次の一手】平日火曜・水曜の稼働が予算を下回っているため、平日限定プランまたは料金ランクの1段階引き下げを検討してください。\n" +
            "【注意】来月上旬に周辺で新規ホテルが開業予定です。競合価格の監視を強化してください。\n" +
            "出典: 価格戦略とランク運用 › ガードレール / 需要要因と係数の考え方 › 係数の初期値",
          generatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        }
      }
    )
  },

  // ---- 要因の評価（アブレーション・成績表・推奨の効果） ----

  factorEvaluation(hotelId: string, lookbackDays?: number): Promise<FactorEvaluation> {
    const params = new URLSearchParams({ hotelId })
    if (lookbackDays != null) params.set("lookbackDays", String(lookbackDays))
    return withDemoFallback(
      () => rawRequest(`/api/v1/pricing/evaluation/factors?${params.toString()}`),
      () => mockFactorEvaluation(hotelId, lookbackDays ?? 90)
    )
  },

  recommendationEffect(hotelId: string, lookbackDays?: number): Promise<RecommendationEffect> {
    const params = new URLSearchParams({ hotelId })
    if (lookbackDays != null) params.set("lookbackDays", String(lookbackDays))
    return withDemoFallback(
      () => rawRequest(`/api/v1/pricing/evaluation/effect?${params.toString()}`),
      () => mockRecommendationEffect(hotelId, lookbackDays ?? 90)
    )
  },

  /** 競合の満室を需要シグナルから除外／復帰する（MANAGER以上） */
  setCompetitorSoldOutIgnored(input: SetCompetitorSoldOutIgnoredInput): Promise<CompetitorSoldOutResult> {
    return withDemoFallback(
      () =>
        rawRequest("/api/v1/integrations/competitor-prices/soldout", {
          method: "PATCH",
          body: JSON.stringify(input),
        }),
      () => {
        const def = MOCK_COMPETITOR_DEFS.find((c) => c.id === input.competitorId)
        return {
          competitorId: input.competitorId,
          competitorName: def?.name ?? input.competitorId,
          date: input.date,
          soldOut: true,
          soldOutIgnored: input.ignored,
        }
      }
    )
  },

  // ---- 基礎資料（知識ベース） ----

  knowledgeStatus(): Promise<KnowledgeStatus> {
    return withDemoFallback(
      () => rawRequest("/api/v1/knowledge/status"),
      () => mockKnowledgeStatus()
    )
  },

  knowledgeSearch(q: string, k?: number): Promise<KnowledgeSearchHit[]> {
    const params = new URLSearchParams({ q })
    if (k != null) params.set("k", String(k))
    return withDemoFallback(
      () => rawRequest(`/api/v1/knowledge/search?${params.toString()}`),
      () => mockKnowledgeSearch(q, k ?? 5)
    )
  },

  /** docs/knowledge を再読込する（ADMINのみ） */
  reloadKnowledge(): Promise<KnowledgeReloadResult> {
    return withDemoFallback(
      () => rawRequest("/api/v1/knowledge/reload", { method: "POST" }),
      () => {
        mockKnowledgeLoadedAt.value = new Date().toISOString()
        const status = mockKnowledgeStatus()
        return { dir: status.dir ?? "docs/knowledge", chunks: status.chunks, documents: status.documents }
      }
    )
  },

  // ---- 個社MD（テナント固有の知識文書） ----

  /** 個社MD一覧（このホテル向け＋テナント共通。テナント共通は hotelId = null） */
  knowledgeDocuments(hotelId: string): Promise<KnowledgeDocumentSummary[]> {
    const params = new URLSearchParams({ hotelId })
    return withDemoFallback(
      () => rawRequest(`/api/v1/knowledge/documents?${params.toString()}`),
      () =>
        mockTenantDocuments
          .filter((d) => d.hotelId == null || d.hotelId === hotelId)
          .map(toKnowledgeDocumentSummary)
    )
  },

  knowledgeDocument(id: string, hotelId: string): Promise<KnowledgeDocumentDetail> {
    const params = new URLSearchParams({ hotelId })
    return withDemoFallback(
      () => rawRequest(`/api/v1/knowledge/documents/${encodeURIComponent(id)}?${params.toString()}`),
      () => ({ ...findMockTenantDocument(id), revisions: [...findMockTenantDocument(id).revisions] })
    )
  },

  /** 「## ルール」節の解釈結果を保存せずに返す（エディタのプレビュー用） */
  previewKnowledgeDocument(hotelId: string, body: string): Promise<RuleParseResult> {
    return withDemoFallback(
      () =>
        rawRequest("/api/v1/knowledge/documents/preview", {
          method: "POST",
          body: JSON.stringify({ hotelId, body }),
        }),
      () => mockParseRules(body)
    )
  },

  /** 個社MDを新規作成し、ルール節があれば反映する（MANAGER以上） */
  createKnowledgeDocument(input: SaveKnowledgeDocumentInput): Promise<SavedKnowledgeDocument> {
    return withDemoFallback(
      async () => {
        const { data, message } = await rawRequestEnvelope<SavedKnowledgeDocument>("/api/v1/knowledge/documents", {
          method: "POST",
          body: JSON.stringify(input),
        })
        return { ...data, message }
      },
      () => mockSaveKnowledgeDocument(null, input)
    )
  },

  /** 個社MDを更新し、ルール節があれば反映する（MANAGER以上） */
  updateKnowledgeDocument(id: string, input: SaveKnowledgeDocumentInput): Promise<SavedKnowledgeDocument> {
    return withDemoFallback(
      async () => {
        const { data, message } = await rawRequestEnvelope<SavedKnowledgeDocument>(
          `/api/v1/knowledge/documents/${encodeURIComponent(id)}`,
          { method: "PUT", body: JSON.stringify(input) }
        )
        return { ...data, message }
      },
      () => mockSaveKnowledgeDocument(findMockTenantDocument(id), input)
    )
  },

  /** 保存済みの個社MDのルールを再反映する（MANAGER以上） */
  applyKnowledgeDocument(id: string, hotelId: string): Promise<ApplyKnowledgeDocumentResult> {
    const params = new URLSearchParams({ hotelId })
    return withDemoFallback(
      async () => {
        const { data, message } = await rawRequestEnvelope<ApplyKnowledgeDocumentResult>(
          `/api/v1/knowledge/documents/${encodeURIComponent(id)}/apply?${params.toString()}`,
          { method: "POST" }
        )
        return { ...data, message }
      },
      () => {
        const doc = findMockTenantDocument(id)
        const parsed = mockParseRules(doc.body)
        if (!parsed.found) {
          return { applied: null, message: "「## ルール」節がないため、反映するルールがありません" }
        }
        if (parsed.errors.length > 0) {
          return { applied: null, message: `解釈できない行が ${parsed.errors.length} 件あるため、ルールは反映していません` }
        }
        doc.rules = parsed.rules
        doc.rulesErrors = []
        doc.rulesAppliedAt = new Date().toISOString()
        const applied = mockApplyRules(doc.hotelId, parsed.rules)
        return { applied, message: `ルールを反映しました（${applied.recomputedDays}日を再計算）` }
      }
    )
  },

  /** 個社MDを削除する（MANAGER以上） */
  deleteKnowledgeDocument(id: string, hotelId: string): Promise<void> {
    const params = new URLSearchParams({ hotelId })
    return withDemoFallback(
      () => rawRequest(`/api/v1/knowledge/documents/${encodeURIComponent(id)}?${params.toString()}`, { method: "DELETE" }),
      () => {
        const idx = mockTenantDocuments.findIndex((d) => d.id === id)
        if (idx < 0) throw new ApiClientError(404, "個社MDが見つかりません")
        mockTenantDocuments.splice(idx, 1)
      }
    )
  },
}
