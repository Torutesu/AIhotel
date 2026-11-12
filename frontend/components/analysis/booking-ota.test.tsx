import { describe, it, expect, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"

import { BookingPeriodAnalysisSection } from "./booking-period-analysis-section"
import { GuestCountAnalysisSection } from "./guest-count-analysis-section"
import { OtaPromotionSection, lastTuesday, sampleOtaPromotions } from "./ota-promotion-section"
import { buildPeriodData, LEAD_TIME_WINDOWS } from "@/lib/api/demo-reservations-sample"
import { mockBookingWindows, mockGuestCounts } from "@/lib/api/demo-reservations"

// 予約動向のリードタイム分析（PDF c分析03）・利用人数別（c分析02）と OTA販促状況（PDF c分析06）

const bookingWindows = vi.fn()
const guestCounts = vi.fn()
vi.mock("@/components/app-state-provider", () => ({ usePeriod: () => ({ periodMonth: "2026-10", setPeriodMonth: vi.fn() }) }))
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ hotelId: "h1" }) }))
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: {
    bookingWindows: (...a: unknown[]) => bookingWindows(...a),
    guestCounts: (...a: unknown[]) => guestCounts(...a),
    aiSummary: async () => null,
  },
}))

describe("リードタイム分析（予約明細の実データ — D-13）", () => {
  it("予約と CXL の表を指示の項目で出す", async () => {
    bookingWindows.mockResolvedValue(mockBookingWindows(2026, 10))
    render(<BookingPeriodAnalysisSection targetPeriod="2026-10" />)
    const booking = await screen.findByTestId("lead-time-booking-table")
    expect(bookingWindows).toHaveBeenCalledWith("h1", 2026, 10)
    const rows = within(booking).getAllByRole("row").slice(1)
    expect(rows.map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual([...LEAD_TIME_WINDOWS])
    const headers = within(booking).getAllByRole("columnheader").map((h) => h.textContent)
    expect(headers.slice(1)).toEqual(["販売室数", "稼働率", "ADR", "客単価", "室料売上", "売上構成比", "CXL率", "DOR", "平均宿泊数", "前年同月比"])
    const cancel = screen.getByTestId("lead-time-cancel-table")
    expect(within(cancel).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "期間",
      "室数",
      "CXL率",
      "ADR",
      "客単価",
      "CXL室料",
      "構成比",
      "DOR",
      "平均宿泊数",
      "前年同月比",
    ])
  })

  it("予約明細が無い月は取り込みを案内する", async () => {
    bookingWindows.mockResolvedValue({ bookings: [], cancels: [], reservations: 0 })
    render(<BookingPeriodAnalysisSection targetPeriod="2026-10" />)
    expect(await screen.findByTestId("no-reservations")).toBeTruthy()
  })

  it("構成比は合わせて100%前後になる（デモのサンプル）", () => {
    const { bookingWindowData, cancelData, guestCountData } = buildPeriodData("2026-10")
    const sum = (list: number[]) => list.reduce((a, b) => a + b, 0)
    expect(sum(bookingWindowData.map((r) => r.revenueShare))).toBeCloseTo(100, 0)
    expect(sum(cancelData.map((r) => r.share))).toBeCloseTo(100, 0)
    expect(sum(guestCountData.map((r) => r.roomsShare))).toBeCloseTo(100, 0)
  })
})

describe("利用人数別（予約明細の実データ — D-13）", () => {
  it("区分の表を出し、積み上がりが実データならサンプルの注記を出さない", async () => {
    guestCounts.mockResolvedValue(mockGuestCounts(2026, 10))
    render(<GuestCountAnalysisSection targetPeriod="2026-10" />)
    const table = await screen.findByTestId("guest-count-composition-table")
    expect(guestCounts).toHaveBeenCalledWith("h1", 2026, 10)
    expect(within(table).getAllByRole("row").length).toBeGreaterThan(1)
    expect(screen.queryByText(/サンプル/)).toBeNull()
  })
})

describe("OTA販促状況（サンプル）", () => {
  it("販促内容一覧を OTA販促データ更新 より先に出し、処理期限を過ぎた販促に色を付ける", () => {
    render(<OtaPromotionSection />)
    const list = screen.getByText("販促内容一覧")
    const update = screen.getByText("OTA販促データ更新")
    expect(list.compareDocumentPosition(update) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const table = screen.getByTestId("ota-promotion-table")
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent).filter(Boolean)
    expect(headers).toEqual(["実績", "販促名", "チャネル", "内容", "処理期限", "実施期間", "予約対象期間", "参加状況", "前年実績", "販売室数", "販売額", "消費数", "実費用"])
    expect(table.querySelectorAll("[data-closed]").length).toBeGreaterThan(0)
    expect(screen.getByText(/毎週火曜日にデータを更新します/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "一休.comの販促データを更新" })).toBeTruthy()
    expect(screen.getByText("一休.comのデータが取得できませんでした。パスワードの更新が必要です。")).toBeTruthy()
  })

  it("直近の火曜日（今日が火曜なら今日）を前回の更新日にする", () => {
    expect(lastTuesday(new Date(2026, 9, 20)).getDate()).toBe(20) // 火曜
    expect(lastTuesday(new Date(2026, 9, 22)).getDate()).toBe(20) // 木曜
    expect(lastTuesday(new Date(2026, 9, 19)).getDate()).toBe(13) // 月曜
    expect(sampleOtaPromotions(new Date(2026, 9, 20)).some((p) => p.deadline < "2026-10-20")).toBe(true)
  })
})
