import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import { DailyDataImportSection } from "@/components/settings/daily-data-import-section"

const mocks = vi.hoisted(() => ({ importDailyData: vi.fn(), role: "MANAGER" as string }))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, api: { importDailyData: mocks.importDailyData } }
})

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ hotelId: "hotel-a", hotel: { totalRooms: 100 }, user: { role: mocks.role } }),
}))

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function selectFile(content: string) {
  const file = new File([content], "実績.csv", { type: "text/csv" })
  fireEvent.change(screen.getByLabelText("実績データの取り込みの CSV ファイル"), { target: { files: [file] } })
}

describe("DailyDataImportSection（#82）", () => {
  beforeEach(() => {
    mocks.role = "MANAGER"
    mocks.importDailyData.mockReset()
  })

  it("まず dryRun で確認し、件数を見せてから取り込む", async () => {
    mocks.importDailyData.mockResolvedValue({
      dryRun: true, total: 1, created: 1, updated: 0, startDate: "2026-09-01", endDate: "2026-09-01",
    })
    render(<DailyDataImportSection />)
    selectFile("日付,販売室数,室料売上\n2026-09-01,80,1600000\n")

    await waitFor(() => expect(screen.getByText(/新規 1行/)).toBeTruthy())
    expect(mocks.importDailyData).toHaveBeenLastCalledWith(
      "hotel-a",
      [{ date: "2026-09-01", soldRooms: 80, totalRevenue: 1_600_000, guests: null }],
      true
    )

    fireEvent.click(screen.getByRole("button", { name: /取り込む/ }))
    await waitFor(() => expect(mocks.importDailyData).toHaveBeenCalledTimes(2))
    expect(mocks.importDailyData.mock.calls[1][2]).toBe(false)
  })

  it("サーバーが返した行エラーをファイル上の行番号で表示し、取り込みボタンを出さない", async () => {
    const { ApiClientError } = await import("@/lib/api")
    mocks.importDailyData.mockRejectedValue(
      new ApiClientError(400, "取り込めない行があります", false, [
        { field: "rows.1.soldRooms", message: "販売室数 120 がホテルの客室数 100 を超えています" },
      ])
    )
    render(<DailyDataImportSection />)
    selectFile("日付,販売室数,室料売上\n2026-09-01,80,1600000\n2026-09-02,120,1600000\n")

    await waitFor(() => expect(screen.getByText("3行目: 販売室数 120 がホテルの客室数 100 を超えています")).toBeTruthy())
    expect(screen.queryByRole("button", { name: /取り込む/ })).toBeNull()
  })

  it("形式の誤りはサーバーに送らずに表示する", async () => {
    render(<DailyDataImportSection />)
    selectFile("日付,販売室数,室料売上\n9月1日,80,1600000\n")
    await waitFor(() => expect(screen.getByText(/2行目: 日付は/)).toBeTruthy())
    expect(mocks.importDailyData).not.toHaveBeenCalled()
  })

  it("オペレーターには取り込みの操作を出さない", () => {
    mocks.role = "OPERATOR"
    render(<DailyDataImportSection />)
    expect(screen.queryByRole("button", { name: /CSV を選択/ })).toBeNull()
    expect(screen.getByText(/マネージャー以上/)).toBeTruthy()
  })
})
