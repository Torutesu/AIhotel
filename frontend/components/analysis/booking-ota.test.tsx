import { describe, it, expect, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"

import { BookingPeriodAnalysisSection } from "./booking-period-analysis-section"
import { OtaPromotionSection, lastTuesday, sampleOtaPromotions } from "./ota-promotion-section"
import { buildPeriodData, LEAD_TIME_WINDOWS } from "./sample-period-data"

// 予約動向のリードタイム分析（PDF c分析03）と OTA販促状況（PDF c分析06）

vi.mock("@/components/app-state-provider", () => ({ usePeriod: () => ({ periodMonth: "2026-10", setPeriodMonth: vi.fn() }) }))

describe("リードタイム分析（サンプル）", () => {
  it("期間は 121-180日前まで、予約と CXL の表を指示の項目で出す", () => {
    render(<BookingPeriodAnalysisSection targetPeriod="2026-10" />)
    const booking = screen.getByTestId("lead-time-booking-table")
    const rows = within(booking).getAllByRole("row").slice(1)
    expect(rows.map((r) => within(r).getAllByRole("cell")[0].textContent)).toEqual([...LEAD_TIME_WINDOWS])
    const headers = within(booking).getAllByRole("columnheader").map((h) => h.textContent)
    expect(headers.slice(2)).toEqual(["販売室数", "稼働率", "ADR", "客単価", "室料売上", "売上構成比", "CXL率", "DOR", "平均宿泊数", "前年同月比"])
    // 日のタイプは型の名前（平日A型など）
    expect(within(booking).getAllByText(/^平日[A-D]型$/).length).toBeGreaterThan(0)
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
    expect(screen.getAllByText(/サンプル/).length).toBeGreaterThan(0)
  })

  it("構成比は合わせて100%前後になる", () => {
    const { bookingWindowData, cancelData, guestCountData } = buildPeriodData("2026-10")
    const sum = (list: number[]) => list.reduce((a, b) => a + b, 0)
    expect(sum(bookingWindowData.map((r) => r.revenueShare))).toBeCloseTo(100, 0)
    expect(sum(cancelData.map((r) => r.share))).toBeCloseTo(100, 0)
    expect(sum(guestCountData.map((r) => r.roomsShare))).toBeCloseTo(100, 0)
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
