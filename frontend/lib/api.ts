"use client"

// バックエンドAPIクライアント（C-6）
// next.config.mjs の rewrites により /api/* はバックエンドへプロキシされる。
// 直接バックエンドURLを叩く場合は NEXT_PUBLIC_BACKEND_URL を設定する。

import type { ApiResponse, User, UserRole, Hotel, Event as HotelEvent, PriceRank } from "@shared/types"

export type { Hotel, PriceRank }
export type { Event as HotelEvent } from "@shared/types"

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

// ---- Dev-only demo mode (バックエンド未起動時のみ、UI確認・デモ用) ----
// NEXT_PUBLIC_DEMO_MODE=true をローカルの frontend/.env.local に設定した場合のみ有効。
// 本番ビルド(NODE_ENV=production)では常に無効。バックエンドが応答する限り実APIを使用し、
// 接続できない場合のみログイン・ダッシュボード・ダイナミックプライシング画面のダミーデータに
// フォールバックする。それ以外の画面は対象外で、通常通りローディング/エラー/再試行を表示する。

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

function isDemoModeEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DEMO_MODE === "true"
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

  if (res.status === 401 && retryOn401 && getRefreshToken()) {
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
  } | null
  dailyTrend: Array<{
    date: string
    occupancy: number | null
    adr: number | null
    predictedOccupancy: number | null
    predictedAdr: number | null
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
  competitorAvgPrice: number | null
  confidence: number | null
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
  expectedImpact?: "high" | "medium" | "low"
  description?: string
}

export type UpdateEventInput = Partial<Omit<CreateEventInput, "hotelId">>

export interface UpdateHotelSettingsInput {
  name?: string
  address?: string
  phone?: string
  email?: string
  totalRooms?: number
  weekendDays?: number[]
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
      isActual,
    })
  }

  const adr = soldRoomsSum > 0 ? Math.round(totalRevenue / soldRoomsSum) : 0
  const occupancyRate = actualDays > 0 ? soldRoomsSum / (totalRooms * actualDays) : 0
  const revPar = actualDays > 0 ? totalRevenue / (totalRooms * actualDays) : 0
  const dor = actualDays > 0 ? Math.round((guestsSum / actualDays) * 10) / 10 : 0
  const guestUnitPrice = guestsSum > 0 ? Math.round(totalRevenue / guestsSum) : 0

  const budgetOccupancy = 0.78
  const budgetAdr = 18500
  const budgetRevenue = Math.round(budgetAdr * budgetOccupancy * totalRooms * numDays)
  const budgetRevenueToDate = actualDays > 0 ? Math.round((budgetRevenue / numDays) * actualDays) : null
  const lastYearRevenue = Math.round(budgetRevenue * 0.95)

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
            lastYearAdr: 17200,
            lastYearOccupancy: 0.74,
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

function mockAlerts(): AlertItem[] {
  const today = new Date()
  const plusDays = (n: number) => {
    const d = new Date(today)
    d.setDate(d.getDate() + n)
    return toLocalDateStr(d)
  }
  return [
    {
      id: "mock-alert-1",
      severity: "RED",
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
      title: "競合平均価格との乖離が拡大",
      message: "今週末の自社価格が競合平均より 12% 高くなっています。経過観察してください。",
      linkTab: "daily",
      targetDate: plusDays(2),
      status: "OPEN",
      detectedAt: today.toISOString(),
    },
  ]
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
    const competitorAvgPrice = Math.round((weekend ? 22000 : 15500) * boost * (0.95 + rng() * 0.15))

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
      competitorAvgPrice,
      confidence: Number((0.7 + rng() * 0.25).toFixed(2)),
    })
  }

  return { hotelId, year, month, calendar }
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

  alerts(hotelId: string): Promise<AlertItem[]> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/dashboard/alerts?hotelId=${hotelId}`),
      () => mockAlerts()
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

  bookingCurve(hotelId: string, date: string): Promise<BookingCurve> {
    return rawRequest(`/api/v1/daily/booking-curve?hotelId=${hotelId}&date=${date}`)
  },

  competitorPrices(hotelId: string, startDate: string, endDate: string): Promise<CompetitorPrices> {
    return rawRequest(
      `/api/v1/daily/competitor-prices?hotelId=${hotelId}&startDate=${startDate}&endDate=${endDate}`
    )
  },

  monthlyTrend(hotelId: string, year: number): Promise<MonthlyTrend> {
    return rawRequest(`/api/v1/analysis/monthly?hotelId=${hotelId}&year=${year}`)
  },

  competitorAnalysis(hotelId: string, startDate: string, endDate: string): Promise<CompetitorAnalysis> {
    return rawRequest(
      `/api/v1/analysis/competitor?hotelId=${hotelId}&startDate=${startDate}&endDate=${endDate}`
    )
  },

  priceRanks(hotelId: string): Promise<PriceRank[]> {
    return rawRequest(`/api/v1/settings/price-ranks?hotelId=${hotelId}`)
  },

  updatePriceRank(
    id: string,
    hotelId: string,
    data: Partial<{ label: string; price1P: number; price2P: number; price3P: number; price4P: number }>
  ): Promise<PriceRank> {
    return rawRequest(`/api/v1/settings/price-ranks/${id}?hotelId=${hotelId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    })
  },

  updateHotelSettings(hotelId: string, data: UpdateHotelSettingsInput): Promise<Hotel> {
    return rawRequest(`/api/v1/settings/hotel/${hotelId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    })
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
}
