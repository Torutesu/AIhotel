// 立ち上げ・外部要因・日別予算の API（D-13）。index.ts の api オブジェクトに展開されるので、画面からは api.xxx で呼ぶ。
// 画面はまだ無い（バックエンドの API とデータだけ先に用意した — docs/改善計画.md D-13）。
// デモモードでは呼ばない前提のため、デモのフォールバックは持たない（呼べば実 API に行く）。

import { rawRequest } from "./client"

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
    return rawRequest(`/api/v1/hotels/${hotelId}/forecast-readiness`)
  },

  demandIndex(hotelId: string, months = 6): Promise<DemandIndex> {
    return rawRequest(`/api/v1/external-signals/demand-index?hotelId=${encodeURIComponent(hotelId)}&months=${months}`)
  },

  externalSignalsStatus(hotelId: string): Promise<ExternalSignalsStatus> {
    return rawRequest(`/api/v1/external-signals/status?hotelId=${encodeURIComponent(hotelId)}`)
  },

  dailyBudgets(hotelId: string, year: number, month: number): Promise<DailyBudgetRow[]> {
    return rawRequest(`/api/v1/settings/daily-budgets?hotelId=${encodeURIComponent(hotelId)}&year=${year}&month=${month}`)
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

  /** 新しいテナントの立ち上げ（運営のみ） */
  provisionTenant(input: ProvisionTenantRequest): Promise<ProvisionTenantResult> {
    return rawRequest("/api/v1/platform/tenants/provision", { method: "POST", body: JSON.stringify(input) })
  },
}
