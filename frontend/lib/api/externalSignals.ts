// 立ち上げ・外部要因・日別予算の API（D-13）。index.ts の api オブジェクトに展開されるので、画面からは api.xxx で呼ぶ。
// 読み取りの API はデモモード（バックエンド未接続）でサンプル（demo-external-signals.ts）に切り替わる。
// 保存・取り込み・立ち上げは他の取り込みと同じく実 API だけ（デモ表示中は「保存できません」の案内になる）。

import { rawRequest, withDemoFallback } from "./client"
import { mockDailyBudgets, mockDemandIndex, mockExternalSignalsStatus, mockForecastReadiness } from "./demo-external-signals"

export type ReadinessMode = "coldStart" | "learning" | "full"

/** 予測の準備状況。GET /hotels/:id/forecast-readiness */
export interface ForecastReadiness {
  hotelId: string
  mode: ReadinessMode
  summary: string
  historyDays: number
  openedOn: string | null
  capabilities: Array<{ key: string; label: string; status: "active" | "limited" | "inactive"; detail: string }>
}

/** 月別需要指数（100 = 直近1年の平均稼働）。GET /external-signals/demand-index */
export interface DemandIndex {
  months: Array<{
    year: number
    month: number
    index: number
    components: { seasonal: number | null; events: number; market: number }
    seasons: string[]
    events: Array<{ name: string; startDate: string; endDate: string; expectedImpact: string | null; source: string }>
    signals: Array<{ kind: string; title: string; direction: string; magnitude: string }>
  }>
  basis: string
}

/** 外部要因の取得状況。GET /external-signals/status */
export interface ExternalSignalsStatus {
  weather: { areaCode: string; reportedAt: string; daysAhead: number } | null
  holidays: { knownThrough: number }
  agent: {
    enabled: boolean
    intervalDays: number
    upcomingAgentEvents: number
    activeSignals: number
    recentRuns: Array<{
      startedAt: string
      finishedAt: string | null
      status: string
      model: string
      webSearches: number
      eventsSaved: number
      openingsSaved: number
      signalsSaved: number
      errorMessage: string | null
    }>
  }
}

export interface DailyBudgetRow {
  date: string
  budgetRooms: number | null
  budgetRevenue: number | null
}

export interface ProvisionTenantRequest {
  tenant: { name: string; code: string }
  admin: { email: string; name: string }
  hotel: {
    name: string
    totalRooms: number
    address?: string
    hotelType?: "FULL_SERVICE" | "LIMITED_SERVICE" | "RESORT" | "RYOKAN" | null
    prefectureCode?: string | null
    municipalityCode?: string | null
    marketArea?: string | null
    weekendDays?: number[]
    saleOpenDaysBefore?: number | null
    weatherAreaCode?: string | null
    openedOn?: string | null
  }
}

export interface ProvisionTenantResult {
  tenant: { id: string; name: string; code: string }
  hotel: { id: string; name: string }
  admin: { id: string; email: string; name: string }
  emailSent: boolean
  /** メールで送れなかったときだけ1回返す */
  temporaryPassword: string | null
}

export const externalSignalsEndpoints = {
  forecastReadiness(hotelId: string): Promise<ForecastReadiness> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/hotels/${hotelId}/forecast-readiness`),
      () => mockForecastReadiness(hotelId),
    )
  },

  demandIndex(hotelId: string, months = 6): Promise<DemandIndex> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/external-signals/demand-index?hotelId=${encodeURIComponent(hotelId)}&months=${months}`),
      () => mockDemandIndex(months),
    )
  },

  externalSignalsStatus(hotelId: string): Promise<ExternalSignalsStatus> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/external-signals/status?hotelId=${encodeURIComponent(hotelId)}`),
      () => mockExternalSignalsStatus(),
    )
  },

  dailyBudgets(hotelId: string, year: number, month: number): Promise<DailyBudgetRow[]> {
    return withDemoFallback(
      () => rawRequest(`/api/v1/settings/daily-budgets?hotelId=${encodeURIComponent(hotelId)}&year=${year}&month=${month}`),
      () => mockDailyBudgets(),
    )
  },

  /** 日別の予算の登録。室数・売上の両方を null にした日は登録を消す（MANAGER 以上） */
  saveDailyBudgets(hotelId: string, days: DailyBudgetRow[]): Promise<{ saved: number; cleared: number }> {
    return rawRequest("/api/v1/settings/daily-budgets", { method: "PUT", body: JSON.stringify({ hotelId, days }) })
  },

  /** 過去の予約積上の一括取り込み（MANAGER 以上、1回5,000行まで）。行は残日数か取得日のどちらか */
  importBookingCurve(
    hotelId: string,
    rows: Array<{ stayDate: string; daysBefore?: number | null; capturedDate?: string | null; roomsBooked: number }>,
    dryRun: boolean,
  ): Promise<{ dryRun: boolean; total: number; created: number; updated: number; startDate: string; endDate: string }> {
    return rawRequest("/api/v1/imports/booking-curve", { method: "POST", body: JSON.stringify({ hotelId, rows, dryRun }) })
  },

  /**
   * 予約明細から過去の予約の推移を作って取り込む（推奨の方法 — MANAGER 以上、1回10,000行まで）。
   * stayFrom〜stayTo（62日以内。画面は1か月ずつ）の泊にかかる予約をすべて含めて送る。reservations は送った明細の件数
   */
  importReservations(
    hotelId: string,
    stayFrom: string,
    stayTo: string,
    rows: Array<{ bookedDate: string; checkInDate: string; nights: number; rooms: number; cancelledDate?: string | null }>,
    dryRun: boolean,
  ): Promise<{ dryRun: boolean; total: number; created: number; updated: number; startDate: string; endDate: string; reservations: number }> {
    return rawRequest("/api/v1/imports/reservations", {
      method: "POST",
      body: JSON.stringify({ hotelId, stayFrom, stayTo, rows, dryRun }),
    })
  },

  /** 新しいテナントの立ち上げ（運営のみ） */
  provisionTenant(input: ProvisionTenantRequest): Promise<ProvisionTenantResult> {
    return rawRequest("/api/v1/platform/tenants/provision", { method: "POST", body: JSON.stringify(input) })
  },
}
