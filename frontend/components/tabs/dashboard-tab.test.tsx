import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"

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
vi.mock("@/components/dashboard/alerts-card", () => ({
  AlertsCard: ({ loading }: { loading: boolean }) => <div data-testid="section">{loading ? "アラート（読込中）" : "アラート"}</div>,
}))
vi.mock("@/components/dashboard/ai-summary-card", () => ({
  AiSummaryCard: ({ loading }: { loading: boolean }) => <div data-testid="section">{loading ? "AI解説（読込中）" : "AI解説"}</div>,
}))
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
  beforeEach(() => {
    mocks.period = { year: 2026, month: 11 }
    mocks.dashboardKpi.mockReset().mockResolvedValue({ summary: null })
    mocks.alerts.mockReset().mockResolvedValue([])
    mocks.aiSummary.mockReset().mockResolvedValue(null)
    mocks.getPreferences.mockReset().mockResolvedValue({ dashboard: { showTopSitesSection: false, kpiItems: [] } })
  })

  it("上部にホテル名・アラート・AI解説、その下に対象年月と、対象年月に連動するカードを並べる", async () => {
    render(<DashboardTab />)

    const hotelName = screen.getByRole("heading", { name: "ホテルABCD" })
    expect(screen.getByText("客室数")).toBeTruthy()
    await waitFor(() => expect(screen.getAllByTestId("section")[0].textContent).toBe("アラート"))
    expect(mocks.dashboardKpi).toHaveBeenCalledWith("hotel-a", 2026, 11)
    // アラート・AI解説は対象年月を渡さずに取る（当月に加えて先々も出すため）
    expect(mocks.alerts).toHaveBeenCalledWith("hotel-a", 4)
    expect(mocks.aiSummary).toHaveBeenCalledWith("hotel-a")
    // ホテル名はアラートより上。対象年月の選択と連動するカードは「対象年月の数値」の区切りの中
    expect(hotelName.compareDocumentPosition(screen.getAllByTestId("section")[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const region = within(screen.getByRole("region", { name: "対象年月の数値" }))
    expect(region.getByText("対象年月:dashboard-period:2026-11")).toBeTruthy()
    expect(region.queryByText("アラート")).toBeNull()

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

  it("対象年月を変えても、アラート・AI解説は取り直さず表示したまま。KPI だけその月を取り直す", async () => {
    const { rerender } = render(<DashboardTab />)
    await waitFor(() => expect(screen.getAllByTestId("section")[0].textContent).toBe("アラート"))

    mocks.period = { year: 2026, month: 12 }
    rerender(<DashboardTab />)
    expect(screen.getAllByTestId("section").slice(0, 2).map((el) => el.textContent)).toEqual(["アラート", "AI解説"])
    await waitFor(() => expect(mocks.dashboardKpi).toHaveBeenLastCalledWith("hotel-a", 2026, 12))
    expect(mocks.alerts).toHaveBeenCalledTimes(1)
    expect(mocks.aiSummary).toHaveBeenCalledTimes(1)
    expect(screen.getByText("稼働・ADR月間推移:2026-12")).toBeTruthy()
  })

  it("対象年月の実績が取れないときは、下部にエラーと再試行を出し、上部のアラート・AI解説は残す", async () => {
    mocks.dashboardKpi.mockReset().mockRejectedValue(new Error("network"))
    render(<DashboardTab />)

    await waitFor(() => expect(screen.getByText("対象年月の実績の取得に失敗しました")).toBeTruthy())
    const region = within(screen.getByRole("region", { name: "対象年月の数値" }))
    expect(region.getByText("対象年月の実績の取得に失敗しました")).toBeTruthy()
    expect(region.getByRole("button", { name: "再試行" })).toBeTruthy()
    // 実績を使わないカードは出したまま、実績を使う 月初比較・KPI進捗 は出さない（実績なしと見せない）
    expect(region.getByText("稼働・ADR月間推移:2026-11")).toBeTruthy()
    expect(region.getByText("在庫表:2026-11")).toBeTruthy()
    expect(screen.queryByText(/月初比較:/)).toBeNull()
    expect(screen.queryByText(/KPI進捗:/)).toBeNull()
    await waitFor(() => expect(screen.getAllByTestId("section")[0].textContent).toBe("アラート"))
  })
})
