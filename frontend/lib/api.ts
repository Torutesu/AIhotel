"use client"

// バックエンドAPIクライアント（C-6）
// next.config.mjs の rewrites により /api/* はバックエンドへプロキシされる。
// ブラウザからは常に same-origin（相対パス）で呼ぶ（F-10）。バックエンドの CORS は
// 許可オリジンを限定しているため、ブラウザが直接バックエンドを叩くと弾かれる。
// プロキシ先はサーバー専用の BACKEND_URL（next.config.mjs）で指定する。

import type {
  ApiResponse,
  User,
  UserRole,
  HotelDto as Hotel,
  Event as HotelEvent,
  PriceRank,
  BudgetYear,
  UpsertBudgetsRequest,
  CompetitorSetting,
  CompetitorOtaUrls,
  RegisterUserRequest,
  UpdateUserRequest,
  UpdateAlertStatusRequest,
  ReviewScore,
} from "@shared/types"
import { parseWeekendDays } from "@/lib/date"
import { createSeededRandom } from "@/lib/format"

// フロントエンドが扱うホテルは APIレスポンス型（weekendDays が number[] 確定）に統一する（U-6）
export type { Hotel, PriceRank }
export type { Event as HotelEvent } from "@shared/types"
// Wave C の画面が使う型（X-1〜X-7）。backend の契約は shared/types が唯一の出所
export type {
  BudgetYear,
  MonthlyBudget,
  UpsertBudgetsRequest,
  CompetitorSetting,
  CompetitorOtaUrls,
  RegisterUserRequest,
  UpdateUserRequest,
  ReviewScore,
  AlertStatus,
} from "@shared/types"

const ACCESS_TOKEN_KEY = "hrms.accessToken"
const REFRESH_TOKEN_KEY = "hrms.refreshToken"
const MOCK_USER_KEY = "hrms.mockUser"

/** 常に same-origin。rewrite（next.config.mjs）が /api/* をバックエンドへ中継する。 */
const BASE_URL = ""

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
// ビルド時に NEXT_PUBLIC_DEMO_MODE=true が明示された場合のみ有効（opt-in。既定は無効）。
// 有効時もバックエンドが応答する限り常に実APIを使用し、接続できない場合に限りダミーデータへ
// フォールバックする。フォールバックが起きた場合は画面上部にデモ表示バナーを出すため、
// 「モックへのサイレントフォールバック禁止」の規約には抵触しない。
// 本番ビルドではこの変数を設定しないこと（デモ分岐はツリーシェイクで成果物から消える）。

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
}

/**
 * デモモードが有効か（ビルド時に NEXT_PUBLIC_DEMO_MODE=true が明示されたときのみ true）。
 * 未設定・値の誤り（例: "ture"）は無効側に倒す（opt-in）。本番ビルドで誤ってデモ認証情報や
 * ダミーデータが表示されないようにするため、「既定で無効・明示的に有効化」の向きにしている。
 * なおフォールバックの発動条件はバックエンドに到達できない場合のみで、
 * 実APIが応答する限り常に実データを優先する。
 */
export function isDemoModeEnabled(): boolean {
  // 注意: 他モジュールからこの関数を呼ぶ分岐はミニファイアで畳み込まれず、無効ビルドでも
  // 分岐内のコードが成果物に残る（実行はされない）。成果物から確実に除去したい JSX 等では
  // `process.env.NEXT_PUBLIC_DEMO_MODE === "true"` をそのモジュール内で直接評価すること
  // （login-form.tsx 参照。verify-demo-mode.mjs で検証している）。
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true"
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

  // ログイン自体の 401（認証情報の誤り）はリフレッシュ対象外
  if (res.status === 401 && retryOn401 && !path.startsWith("/api/v1/auth/login")) {
    // 並列に 401 を受けても tryRefresh() は single-flight なので実際の更新は 1 回だけ
    const refreshed = await tryRefresh()
    if (refreshed) {
      return rawRequest<T>(path, options, false)
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

  return body.data as T
}

/** ダウンロード用のバイナリレスポンス */
export interface BinaryDownload {
  blob: Blob
  /** Content-Disposition から取り出したファイル名（取れなければ null） */
  filename: string | null
}

/**
 * バイナリ（PDF/Excel）を取得する。レポート出力のように成功時のエンベロープを持たない
 * エンドポイント専用。失敗時はJSONのエラーエンベロープが返るため、そちらを読んで例外にする。
 */
async function rawBinaryRequest(path: string, retryOn401 = true): Promise<BinaryDownload> {
  const token = getAccessToken()
  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: { ...(token && { Authorization: `Bearer ${token}` }) },
    })
  } catch {
    throw new ApiClientError(0, "バックエンドに接続できません", true)
  }

  if (res.status === 401 && retryOn401) {
    const refreshed = await tryRefresh()
    if (refreshed) return rawBinaryRequest(path, false)
  }

  if (!res.ok) {
    let message = `リクエストに失敗しました (${res.status})`
    try {
      const body = (await res.json()) as ApiResponse<unknown>
      if (body?.error) message = body.error
    } catch {
      // JSONでない場合は既定のメッセージを使う
    }
    throw new ApiClientError(res.status, message)
  }

  return {
    blob: await res.blob(),
    filename: parseContentDispositionFilename(res.headers.get("Content-Disposition")),
  }
}

function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1])
    } catch {
      // デコードできなければ素の filename にフォールバックする
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header)
  return plain ? plain[1] : null
}

/**
 * 認証が完全に失効したことをアプリ全体に通知する（F-2）。
 * AuthProvider がこのイベントを購読してユーザーを破棄し、ログイン画面に戻す。
 */
export const AUTH_EXPIRED_EVENT = "auth:expired"

function notifyAuthExpired() {
  clearTokens()
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
  }
}

/**
 * 実行中のリフレッシュ処理（single-flight 用）。
 * 並列リクエストが同時に 401 を受けても、リフレッシュは 1 回だけ実行し全員でその結果を共有する。
 * 各々がリフレッシュを投げるとトークンローテーションで後続が無効トークンを掴み、
 * 結果として全員ログアウトになってしまうため（F-2）。
 */
let refreshInFlight: Promise<boolean> | null = null

async function performRefresh(refreshToken: string): Promise<boolean> {
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
    // サーバーがリフレッシュを拒否した（期限切れ・失効済み）→ 認証終了
    notifyAuthExpired()
    return false
  } catch {
    // ネットワーク到達不可。トークンは失効していない可能性が高いので破棄しない。
    return false
  }
}

async function tryRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) {
    notifyAuthExpired()
    return false
  }
  if (!refreshInFlight) {
    refreshInFlight = performRefresh(refreshToken).finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
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

export interface PricingStrategy {
  id: string
  hotelId: string
  weightOccupancy: number
  weightAdr: number
  weightCompetitor: number
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

// ---- Dev-only demo data (ダッシュボード/ダイナミックプライシング画面用) ----
// バックエンドの seed データと近い分布になるよう簡易な季節・曜日変動を再現しているだけの
// ダミー値。実データではない。

function toLocalDateStr(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function isMockWeekend(date: Date): boolean {
  return parseWeekendDays(MOCK_HOTEL.weekendDays).includes(date.getDay())
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
    content:
      "今月の稼働率は予算比 +2.1pt と好調に推移しています。週末（金・土）のADRは前年比 +6% で、" +
      "特に土曜日は満室に近い水準です。一方、平日火曜・水曜の稼働が予算を下回っており、" +
      "平日限定プランまたは料金ランク引き下げの検討を推奨します。",
    generatedAt: new Date().toISOString(),
  }
}

function mockPricingCalendar(hotelId: string, year: number, month: number): PricingCalendar {
  const numDays = mockDaysInMonth(year, month)
  const today = new Date()
  const rng = createSeededRandom(year * 100 + month + 7)
  const boost = mockSeasonBoost(month)
  const calendar: PricingCalendarDay[] = []

  for (let d = 1; d <= numDays; d++) {
    const date = new Date(year, month - 1, d)
    const weekend = isMockWeekend(date)
    const isPast = date < today
    const predictedOccupancy = Number(
      Math.min(1, Math.max(0.3, (weekend ? 0.9 : 0.72) * boost + (rng() - 0.5) * 0.1)).toFixed(3)
    )
    const predictedAdr = Math.round((weekend ? 24000 : 17000) * boost)
    const recommendedRank = Math.min(40, Math.max(1, Math.round(predictedOccupancy * 40)))
    const price1P = mockRankToPrice1P(recommendedRank)
    const demandLevel: PricingCalendarDay["demandLevel"] =
      predictedOccupancy > 0.9 ? "A" : predictedOccupancy > 0.8 ? "B" : predictedOccupancy > 0.65 ? "C" : predictedOccupancy > 0.5 ? "D" : "E"
    const competitorMedianPrice = Math.round((weekend ? 22000 : 15500) * boost * (0.95 + rng() * 0.15))

    calendar.push({
      date: toLocalDateStr(date),
      demandLevel,
      recommendedRank,
      recommendedPrice: price1P,
      rankLabel: `R${String(recommendedRank).padStart(2, "0")}`,
      price1P,
      price2P: Math.round(price1P * 1.4),
      price3P: Math.round(price1P * 1.8),
      predictedOccupancy,
      predictedAdr,
      actualOccupancy: isPast ? Number(Math.min(1, predictedOccupancy + (rng() - 0.5) * 0.1).toFixed(3)) : null,
      actualAdr: isPast ? Math.round(predictedAdr * (1 + (rng() - 0.5) * 0.06)) : null,
      competitorMedianPrice,
      competitorMinPrice: Math.round(competitorMedianPrice * 0.88),
      competitorMaxPrice: Math.round(competitorMedianPrice * 1.14),
      confidence: Number((0.7 + rng() * 0.25).toFixed(2)),
    })
  }

  return { hotelId, year, month, calendar }
}

/** 中央値（デモデータ生成用） */
function mockMedian(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid]
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
      medianPrice: mockMedian(values),
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
}

let mockEvents: HotelEvent[] | null = null

function getMockEvents(hotelId: string): HotelEvent[] {
  if (mockEvents) return mockEvents
  const today = new Date()
  mockEvents = [
    {
      id: "mock-event-1",
      hotelId,
      name: "地域花火大会",
      type: "festival",
      startDate: new Date(today.getFullYear(), today.getMonth(), 15),
      endDate: new Date(today.getFullYear(), today.getMonth(), 15),
      location: "近隣河川敷",
      expectedImpact: "high",
      description: "周辺ホテルの需要増加が見込まれます。",
    },
  ]
  return mockEvents
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
      if (mockUser) {
        // リロード後にデモユーザーを復元した場合もデモ表示バナーを出す
        markDemoDataInUse()
        return Promise.resolve({ ...mockUser, hotel: MOCK_HOTEL })
      }
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

  /**
   * KPI比較（月初比較・日付比較 — F-DASH-04）。
   * baseDate を省略すると対象月に紐づく全スナップショットを取得日の昇順で返す。
   */
  kpiComparison(
    hotelId: string,
    year: number,
    month: number,
    baseDate?: string
  ): Promise<KpiSnapshot[]> {
    const baseDateParam = baseDate ? `&baseDate=${baseDate}` : ""
    return rawRequest(
      `/api/v1/dashboard/kpi/comparison?hotelId=${hotelId}&year=${year}&month=${month}${baseDateParam}`
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

  updatePricingStrategy(
    hotelId: string,
    weights: { weightOccupancy: number; weightAdr: number; weightCompetitor: number }
  ): Promise<PricingStrategy> {
    return withDemoFallback(
      () =>
        rawRequest("/api/v1/pricing/strategy", {
          method: "PUT",
          body: JSON.stringify({ hotelId, ...weights }),
        }),
      () => {
        mockStrategy = { ...mockStrategy, hotelId, ...weights }
        return mockStrategy
      }
    )
  },

  /**
   * 月次着地シミュレーション（F-DP-04）。
   * 行が無い月は simulation が null で返る。フロントエンドで平均値を捏造しないこと。
   */
  pricingSimulation(hotelId: string, year: number, month: number): Promise<PricingSimulation> {
    return rawRequest(`/api/v1/pricing/simulation?hotelId=${hotelId}&year=${year}&month=${month}`)
  },

  /**
   * 需要予測の再計算（F-DP-03「AI予測値へリセット」／F-DP-05）。MANAGER 以上。
   * startDate は本日（JST）以降でなければバックエンドが 400 を返す。
   */
  recomputeForecast(
    hotelId: string,
    range?: { startDate?: string; endDate?: string }
  ): Promise<RecomputeForecastResult> {
    return rawRequest("/api/v1/pricing/recompute", {
      method: "POST",
      body: JSON.stringify({ hotelId, ...range }),
    })
  },

  /**
   * 月次レポート（PDF / Excel）のダウンロード（F-REP-01/02）。
   * レスポンスはバイナリのため Blob を返す。保存はコンポーネント側で行う。
   */
  monthlyReport(
    hotelId: string,
    year: number,
    month: number,
    format: "pdf" | "excel"
  ): Promise<BinaryDownload> {
    return rawBinaryRequest(
      `/api/v1/reports/monthly?hotelId=${hotelId}&year=${year}&month=${month}&format=${format}`
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

  /** 料金ランクの追加（MANAGER以上。最大40段階 — F-SET-02） */
  createPriceRank(input: CreatePriceRankInput): Promise<PriceRank> {
    return rawRequest("/api/v1/settings/price-ranks", {
      method: "POST",
      body: JSON.stringify(input),
    })
  },

  /** 料金ランクの削除（MANAGER以上 — F-SET-02） */
  deletePriceRank(id: string, hotelId: string): Promise<void> {
    return rawRequest(`/api/v1/settings/price-ranks/${id}?hotelId=${hotelId}`, {
      method: "DELETE",
    })
  },

  updatePriceRank(
    id: string,
    hotelId: string,
    data: Partial<Omit<CreatePriceRankInput, "hotelId" | "rank">>
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

  events(hotelId: string, startDate?: string, endDate?: string): Promise<HotelEvent[]> {
    const params = new URLSearchParams({ hotelId })
    if (startDate) params.set("startDate", startDate)
    if (endDate) params.set("endDate", endDate)
    return withDemoFallback(
      () => rawRequest(`/api/v1/events?${params.toString()}`),
      () => getMockEvents(hotelId)
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
        const newEvent: HotelEvent = {
          id: `mock-event-${Date.now()}`,
          hotelId: input.hotelId,
          name: input.name,
          type: input.type,
          startDate: new Date(input.startDate),
          endDate: new Date(input.endDate),
          location: input.location,
          expectedImpact: input.expectedImpact,
          description: input.description,
        }
        getMockEvents(input.hotelId).push(newEvent)
        return newEvent
      }
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

  // ---- 月次予算（X-1 / N-1 / F-SET-04） ----

  /** 年単位の月次予算。未登録の月も budget: null で必ず12件返る */
  budgets(hotelId: string, year: number): Promise<BudgetYear> {
    return rawRequest(`/api/v1/settings/budgets?hotelId=${hotelId}&year=${year}`)
  },

  /**
   * 月次予算の一括保存（MANAGER以上）。送った月だけが upsert される。
   * 稼働率は 0〜1 の比率で送ること（UI 側のパーセント入力は呼び出し元で変換する）。
   */
  saveBudgets(input: UpsertBudgetsRequest): Promise<BudgetYear> {
    return rawRequest("/api/v1/settings/budgets", {
      method: "PUT",
      body: JSON.stringify(input),
    })
  },

  // ---- 競合ホテル（X-2 / N-2 / F-SET-03） ----

  /** 競合ホテル一覧（有効なもののみ。最大5件） */
  competitorSettings(hotelId: string): Promise<CompetitorSetting[]> {
    return rawRequest(`/api/v1/settings/competitors?hotelId=${hotelId}`)
  },

  /** 競合ホテルの追加（MANAGER以上）。6件目は 400 になる */
  createCompetitor(input: CreateCompetitorInput): Promise<CompetitorSetting> {
    return rawRequest("/api/v1/settings/competitors", {
      method: "POST",
      body: JSON.stringify(input),
    })
  },

  /** 競合ホテルの更新（MANAGER以上） */
  updateCompetitor(
    id: string,
    hotelId: string,
    input: UpdateCompetitorInput
  ): Promise<CompetitorSetting> {
    return rawRequest(`/api/v1/settings/competitors/${id}?hotelId=${hotelId}`, {
      method: "PUT",
      body: JSON.stringify(input),
    })
  },

  /** 競合ホテルの削除（MANAGER以上・論理削除） */
  deleteCompetitor(id: string, hotelId: string): Promise<void> {
    return rawRequest(`/api/v1/settings/competitors/${id}?hotelId=${hotelId}`, {
      method: "DELETE",
    })
  },

  // ---- ユーザー管理（X-3 / N-3） ----

  /** 同一テナントのユーザー一覧（ADMIN / MANAGER のみ。OPERATOR は 403） */
  users(hotelId: string): Promise<User[]> {
    return rawRequest(`/api/v1/users?hotelId=${hotelId}`)
  },

  /** ユーザーの名前・ロール・有効/無効の変更（ADMIN、または自テナント内の MANAGER） */
  updateUser(id: string, input: UpdateUserRequest): Promise<User> {
    return rawRequest(`/api/v1/users/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    })
  },

  /** ユーザーの招待（ADMIN / MANAGER）。MANAGER は自テナントのホテル指定が必須 */
  registerUser(input: RegisterUserRequest): Promise<User> {
    return rawRequest("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    })
  },

  // ---- アラート操作（X-4 / N-4） ----

  /**
   * アラートの状態遷移。ACKNOWLEDGED は全ロール、RESOLVED は MANAGER 以上。
   * RESOLVED から ACKNOWLEDGED へ戻す操作はバックエンドが 400 で拒否する。
   */
  updateAlertStatus(
    id: string,
    hotelId: string,
    status: UpdateAlertStatusRequest["status"]
  ): Promise<AlertItem> {
    return rawRequest(`/api/v1/dashboard/alerts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ hotelId, status }),
    })
  },

  // ---- 口コミ評価点（X-6 / N-7 / F-ANA-04） ----

  /** OTA別の口コミ評価点（取得日の降順・最大50件） */
  reviewScores(hotelId: string): Promise<ReviewScore[]> {
    return rawRequest(`/api/v1/analysis/reviews?hotelId=${hotelId}`)
  },

  // ---- KPIスナップショット取得（X-7 / N-5） ----

  /**
   * 当日時点のKPIスナップショットを保存する（MANAGER以上）。
   * 通常は日次バッチが実行する処理で、同じ日・同じ対象月に対して冪等。
   */
  createKpiSnapshot(hotelId: string, year: number, month: number): Promise<KpiSnapshot> {
    return rawRequest("/api/v1/dashboard/kpi/snapshot", {
      method: "POST",
      body: JSON.stringify({ hotelId, year, month }),
    })
  },
}
