import { describe, it, expect, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

import { DashboardTab } from "./dashboard-tab"

// ダッシュボードの並び（2026-10-23 の画面修正 PDF a01）:
// 上部 = ホテル名・客室数・アラート・AI解説（現在〜先々のお知らせ。対象年月に連動しない）
// 下部 = 対象年月 → 稼働・ADR月間推移・月初比較・日付比較・KPI進捗・在庫表（対象年月に連動）

const mocks = vi.hoisted(() => ({
  dashboardKpi: vi.fn(),
  alerts: vi.fn(),
  aiSummary: vi.fn(),
  getPreferences: vi.fn(),
  period: { year: 2026, month: 11 },
}))

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ hotelId: "hotel-a", hotel: { id: "hotel-a", name: "ホテルABCD", totalRooms: 200 } }),
}))
vi.mock("@/components/app-state-provider", () => ({
  usePeriod: () => ({
    ...mocks.period,
    periodMonth: `${mocks.period.year}-${String(mocks.period.month).padStart(2, "0")}`,
    setPeriodMonth: vi.fn(),
  }),
}))
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    api: {
      ...actual.api,
      dashboardKpi: mocks.dashboardKpi,
      alerts: mocks.alerts,
      aiSummary: mocks.aiSummary,
      getPreferences: mocks.getPreferences,
    },
  }
})
vi.mock("@/components/month-picker", () => ({
  LabeledMonthPicker: ({ id, label, value }: { id: string; label: string; value: string }) => (
    <div data-testid="section">
      {label}:{id}:{value}
    </div>
  ),
}))
// 各カードは目印だけにして、並び順と渡す対象年月を確かめる
vi.mock("@/components/onboarding/setup-checklist-card", () => ({ SetupChecklistCard: () => null }))
vi.mock("@/components/dashboard/alerts-card", () => ({ AlertsCard: () => <div data-testid="section">アラート</div> }))
vi.mock("@/components/dashboard/ai-summary-card", () => ({ AiSummaryCard: () => <div data-testid="section">AI解説</div> }))
vi.mock("@/components/dashboard/booking-curve-month-card", () => ({
  BookingCurveMonthCard: ({ year, month }: { year: number; month: number }) => (
    <div data-testid="section">稼働・ADR月間推移:{year}-{month}</div>
  ),
}))
vi.mock("@/components/dashboard/kpi-comparison-section", () => ({
  KpiComparisonSection: ({ year, month }: { year: number; month: number }) => (
    <div data-testid="section">月初比較:{year}-{month}</div>
  ),
}))
vi.mock("@/components/dashboard/kpi-progress-section", () => ({
  ALL_KPI_KEYS: ["revenue"],
  KpiProgressSection: ({ year, month }: { year: number; month: number }) => (
    <div data-testid="section">KPI進捗:{year}-{month}</div>
  ),
}))
vi.mock("@/components/dashboard/inventory-table-card", () => ({
  InventoryTableCard: ({ year, month }: { year: number; month: number }) => (
    <div data-testid="section">在庫表:{year}-{month}</div>
  ),
}))

describe("DashboardTab", () => {
  it("上部にホテル名・アラート・AI解説、その下に対象年月と、対象年月に連動するカードを並べる", async () => {
    mocks.dashboardKpi.mockResolvedValue({ summary: null })
    mocks.alerts.mockResolvedValue([])
    mocks.aiSummary.mockResolvedValue(null)
    mocks.getPreferences.mockResolvedValue({ dashboard: { showTopSitesSection: false, kpiItems: [] } })

    render(<DashboardTab />)

    expect(screen.getByRole("heading", { name: "ホテルABCD" })).toBeTruthy()
    expect(screen.getByText("客室数")).toBeTruthy()
    await waitFor(() => expect(mocks.dashboardKpi).toHaveBeenCalledWith("hotel-a", 2026, 11))
    // アラート・AI解説は対象年月を渡さずに取る（当月に加えて先々も出すため）
    expect(mocks.alerts).toHaveBeenCalledWith("hotel-a", 4)
    expect(mocks.aiSummary).toHaveBeenCalledWith("hotel-a")

    expect(screen.getAllByTestId("section").map((el) => el.textContent)).toEqual([
      "アラート",
      "AI解説",
      "対象年月:dashboard-period:2026-11",
      "稼働・ADR月間推移:2026-11",
      "月初比較:2026-11",
      "KPI進捗:2026-11",
      "在庫表:2026-11",
    ])
    expect(screen.getByText(/ここから下は対象年月の数値です/)).toBeTruthy()
  })
})
