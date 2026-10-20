import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import { KpiComparisonSection } from "./kpi-comparison-section"

// 月初比較・日付比較（PDF aダッシュボード02「対象年月選択」）: カードで別の月を選ぶとその月の実績を取り直す。
// 取得に失敗したときは「実績なし」と見せず、エラーと再試行を出す

const mocks = vi.hoisted(() => ({ kpiComparison: vi.fn(), dashboardKpi: vi.fn() }))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, api: { ...actual.api, ...mocks } }
})
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ hotelId: "hotel-a", user: { role: "OPERATOR" } }) }))
// 月の選択欄は値を入れるだけの欄に置き換える（Radix の Select は jsdom で開けないため）
vi.mock("@/components/month-picker", () => ({
  LabeledMonthPicker: ({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) => (
    <input aria-label={id} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

const SUMMARY = {
  actualDays: 19,
  roomRevenue: 47_000_000,
  soldRooms: 2700,
  adr: 17_400,
  occupancyRate: 0.71,
  revPar: 12_400,
} as unknown as Parameters<typeof KpiComparisonSection>[0]["summary"]

describe("KpiComparisonSection", () => {
  beforeEach(() => {
    mocks.kpiComparison.mockReset().mockResolvedValue([])
    mocks.dashboardKpi.mockReset()
  })

  it("既定はダッシュボードの対象年月で、その月の実績は取り直さない", async () => {
    render(<KpiComparisonSection year={2026} month={10} summary={SUMMARY} />)
    await waitFor(() => expect(mocks.kpiComparison).toHaveBeenCalledWith("hotel-a", 2026, 10))
    expect((screen.getByLabelText("comparison-month") as HTMLInputElement).value).toBe("2026-10")
    expect(mocks.dashboardKpi).not.toHaveBeenCalled()
  })

  it("別の月を選ぶとその月の実績を取り直し、失敗したらエラーと再試行を出す", async () => {
    mocks.dashboardKpi.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ summary: SUMMARY })
    render(<KpiComparisonSection year={2026} month={10} summary={SUMMARY} />)
    fireEvent.change(screen.getByLabelText("comparison-month"), { target: { value: "2026-09" } })
    await waitFor(() => expect(screen.getByText("対象月の実績の取得に失敗しました")).toBeTruthy())
    expect(mocks.dashboardKpi).toHaveBeenCalledWith("hotel-a", 2026, 9)
    expect(mocks.kpiComparison).toHaveBeenLastCalledWith("hotel-a", 2026, 9)
    expect(screen.queryByText(/当月の実績がまだ取得できていません/)).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "再試行" }))
    await waitFor(() => expect(screen.getAllByText(/2026年9月のKPIスナップショットがまだ記録されていません/).length).toBeGreaterThan(0))
  })
})
