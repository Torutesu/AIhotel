"use client"

// バックエンドAPIクライアント（C-6）。画面は必ず @/lib/api から import する。
// 呼び出し口（api オブジェクト）をここに置き、土台（client.ts）・型（types.ts）・
// デモ用データ（demo-data.ts）は別ファイルに分けている（#91）。
// ブラウザからは常に same-origin（相対パス）で呼び、app/api/[...path]/route.ts が
// サーバー専用の BACKEND_URL へ中継する（F-10）。

import type {
  User, HotelDto as Hotel, Event as HotelEvent, PriceRank, BudgetYear, UpsertBudgetsRequest,
  CompetitorSetting, RegisterUserRequest, UpdateUserRequest, UpdateAlertStatusRequest, ReviewScore,
  RoomType, RoomTypeInput, TenantSummary, AuditLogItem
} from "@shared/types"
import {
  ApiClientError, getRefreshToken, storeTokens, clearTokens, MOCK_HOTEL, isDemoModeEnabled,
  markDemoDataInUse, storeMockUser, getMockUser, mockLogin, withDemoFallback, rawRequest,
  rawBinaryRequest, type BinaryDownload
} from "./client"
import type {
  LoginResult, DashboardKpi, KpiSnapshot, AlertItem, AiSummary, PricingCalendar, PricingSimulation,
  RecomputeForecastResult, RecomputeSimulationResult, PricingStrategy, PricingStrategyInput, PricingLockPeriod, BookingCurve,
  CompetitorPrices, MonthlyTrend, CompetitorAnalysis, CreateEventInput, UpdateEventInput,
  CreatePriceRankInput, UpdateHotelSettingsInput, SetupStatus, CreateCompetitorInput, UpdateCompetitorInput,
  DashboardPreference, UserPreferences
} from "./types"
import {
  mockDashboardKpi, mockAlerts, mockAiSummary, mockPricingCalendar, mockBookingCurve,
  mockCompetitorPrices, mockMonthlyTrend, mockCompetitorAnalysis, getMockPriceRanks, mockStrategy,
  setMockStrategy, setMockEvents, getMockEvents
} from "./demo-data"
import { adminEndpoints } from "./admin"
import { analysisEndpoints } from "./analysis"

// フロントエンドが扱うホテルは APIレスポンス型（weekendDays が number[] 確定）に統一する（U-6）
export type { Hotel, PriceRank, RoomType, RoomTypeInput, TenantSummary, AuditLogItem }
export type { Event as HotelEvent } from "@shared/types"
// Wave C の画面が使う型（X-1〜X-7）。backend の契約は shared/types が唯一の出所
export type {
  BudgetYear, MonthlyBudget, UpsertBudgetsRequest, CompetitorSetting, CompetitorOtaUrls,
  RegisterUserRequest, UpdateUserRequest, ReviewScore, AlertStatus, HotelType
} from "@shared/types"

export * from "./types"
export {
  ApiClientError, getAccessToken, getRefreshToken, storeTokens, clearTokens, isDemoModeEnabled,
  isDemoDataInUse, subscribeDemoData, AUTH_EXPIRED_EVENT
} from "./client"
export type { BinaryDownload } from "./client"

// ---- API surface ----

export const api = {
  // 運営・管理者向け（取り込み・ホテル・部屋タイプ・テナント・一時パスワード・監査ログ）は admin.ts
  ...adminEndpoints,
  // 分析タブの内訳（チャネル別・部屋タイプ別・曜日別 — #88）は analysis.ts
  ...analysisEndpoints,

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

  /**
   * 本人のパスワード変更（#89）。ほかの端末のセッションは失効し、この端末には新しいトークンが返る
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<User> {
    const result = await rawRequest<LoginResult>("/api/v1/auth/password", {
      method: "PUT",
      body: JSON.stringify({ currentPassword, newPassword }),
    })
    storeTokens(result.tokens.accessToken, result.tokens.refreshToken)
    return result.user
  },

  /** すべての端末からログアウトする（#89）。この端末のトークンも消す */
  async logoutAll(): Promise<void> {
    try {
      await rawRequest("/api/v1/auth/logout-all", { method: "POST" })
    } finally {
      clearTokens()
    }
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

  updatePricingStrategy(hotelId: string, input: PricingStrategyInput): Promise<PricingStrategy> {
    return withDemoFallback(
      () =>
        rawRequest("/api/v1/pricing/strategy", {
          method: "PUT",
          body: JSON.stringify({ hotelId, ...input }),
        }),
      () => {
        return setMockStrategy({ ...mockStrategy, hotelId, ...input })
      }
    )
  },

  /** 推奨を固定する期間（#17）。今日以降に終わるものだけが返る */
  pricingLocks(hotelId: string): Promise<PricingLockPeriod[]> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/pricing/locks?hotelId=${hotelId}`),
      () => []
    )
  },

  createPricingLock(input: { hotelId: string; startDate: string; endDate: string; reason?: string }): Promise<PricingLockPeriod> {
    return rawRequest("/api/v1/pricing/locks", { method: "POST", body: JSON.stringify(input) })
  },

  deletePricingLock(hotelId: string, id: string): Promise<void> {
    return rawRequest(`/api/v1/pricing/locks/${id}?hotelId=${hotelId}`, { method: "DELETE" })
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
   * 月間着地シミュレーションの再計算（F-DP-04 / N-5）。MANAGER 以上。
   * 需要予測（recomputeForecast）を更新しただけでは着地予測は変わらないため、
   * 「AI予測値へリセット」では予測の再計算に続けてこれを呼ぶ（#77）。
   */
  recomputeSimulation(hotelId: string, year: number, month: number): Promise<RecomputeSimulationResult> {
    return rawRequest("/api/v1/pricing/simulation/recompute", {
      method: "POST",
      body: JSON.stringify({ hotelId, year, month }),
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

  /** 初期設定の進み具合（#13）。デモでは完了扱いにする */
  hotelSetupStatus(hotelId: string): Promise<SetupStatus> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/hotels/${hotelId}/setup-status`),
      () => ({ hotelId, ready: true, items: [] })
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
        setMockEvents(getMockEvents(hotelId).filter((e) => e.id !== id))
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

  // ---- ユーザー管理（X-3 / N-3 / #62） ----
  // いずれも自テナント内に限定される（ADMIN も例外ではない）。テナントを越えられるのは運営のみ。

  /** 同一テナントのユーザー一覧（ADMIN / MANAGER のみ。OPERATOR は 403） */
  users(hotelId: string): Promise<User[]> {
    return rawRequest(`/api/v1/users?hotelId=${hotelId}`)
  },

  /** ユーザーの名前・ロール・有効/無効の変更（自テナント内の ADMIN / MANAGER。運営ロールの付与は運営のみ） */
  updateUser(id: string, input: UpdateUserRequest): Promise<User> {
    return rawRequest(`/api/v1/users/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    })
  },

  /** ユーザーの招待（ADMIN / MANAGER）。作成先テナントは常に呼び出し元のテナント。MANAGER はホテル指定が必須 */
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

  // ---- 画面表示設定（#51-2） ----

  /** 自分の表示設定を取得する。未保存ならバックエンドが既定値を返す */
  getPreferences(hotelId: string): Promise<UserPreferences> {
    return rawRequest(`/api/v1/preferences?hotelId=${hotelId}`)
  },

  /** 自分の表示設定を保存する（ロール不問。他人の設定には影響しない） */
  updatePreferences(
    hotelId: string,
    dashboard: DashboardPreference
  ): Promise<UserPreferences> {
    return rawRequest("/api/v1/preferences", {
      method: "PUT",
      body: JSON.stringify({ hotelId, dashboard }),
    })
  },
}
