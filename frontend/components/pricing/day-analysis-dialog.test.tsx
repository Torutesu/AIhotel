import { describe, it, expect, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

import { adjacentMonthsNeeded, DayAnalysisDialog, neighborDates } from "./day-analysis-dialog"
import type { PricingCalendarDay } from "@/lib/api"

// 日のAI分析（2026-10 の画面修正 DP03: 日のタイプとその推移、月をまたぐ前後2日ずつの周辺日）

const mocks = vi.hoisted(() => ({ pricingCalendar: vi.fn() }))

vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ hotelId: "hotel-a" }) }))
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, api: { ...actual.api, pricingCalendar: mocks.pricingCalendar } }
})

function day(date: string, overrides: Partial<PricingCalendarDay> = {}): PricingCalendarDay {
  return {
    date,
    demandLevel: "C",
    recommendedRank: 28,
    recommendedPrice: 22769,
    rankLabel: "R28",
    price1P: 22769,
    price2P: null,
    price3P: null,
    predictedOccupancy: 0.71,
    predictedAdr: 22000,
    actualOccupancy: null,
    actualAdr: null,
    competitorMedianPrice: 14880,
    competitorMinPrice: null,
    competitorMaxPrice: null,
    confidence: 0.8,
    budgetRooms: 140,
    budgetOccupancy: 0.7,
    budgetAdr: 18500,
    budgetRevenue: 2590000,
    onHandRooms: 62,
    currentOccupancy: 0.31,
    onHandAdr: null,
    currentRevenue: null,
    expectedRevenue: 3100000,
    dayType: "C3",
    dayTypeExpectedOccupancy: 0.72,
    dayTypePaceRatio: 1.01,
    dayTypeHistory: [],
    ...overrides,
  }
}

describe("neighborDates / adjacentMonthsNeeded", () => {
  it("前後2日ずつの5日を、月をまたいで並べる", () => {
    expect(neighborDates("2026-10-01")).toEqual(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"])
    expect(neighborDates("2026-12-31")).toEqual(["2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"])
  })
  it("月の端の日だけ、前後の月の取得が要る", () => {
    expect(adjacentMonthsNeeded("2026-10-01")).toEqual([{ year: 2026, month: 9 }])
    expect(adjacentMonthsNeeded("2026-12-31")).toEqual([{ year: 2027, month: 1 }])
    expect(adjacentMonthsNeeded("2026-10-15")).toEqual([])
  })
})

describe("DayAnalysisDialog", () => {
  it("日のタイプと推移を出し、月初の日は前月の日も周辺日に並べる", async () => {
    mocks.pricingCalendar.mockResolvedValue({
      hotelId: "hotel-a",
      year: 2026,
      month: 9,
      calendar: [day("2026-09-29", { dayType: "B2" }), day("2026-09-30", { dayType: "B1" })],
    })
    const selected = day("2026-10-01", {
      dayType: "D4",
      demandLevel: "B",
      dayTypePaceRatio: 0.88,
      dayTypeHistory: [
        { daysBefore: 90, dayType: "D3", otbRooms: 12, paceRatio: 1 },
        { daysBefore: 60, dayType: "D4", otbRooms: 20, paceRatio: 0.9 },
      ],
    })
    const days = [selected, day("2026-10-02"), day("2026-10-03")]
    render(<DayAnalysisDialog day={selected} days={days} onClose={vi.fn()} />)

    expect(screen.getByText("2026年10月1日（木）のAI分析")).toBeTruthy()
    expect(mocks.pricingCalendar).toHaveBeenCalledWith("hotel-a", 2026, 9)
    await waitFor(() => expect(screen.getByText("9/29")).toBeTruthy())
    expect(screen.getAllByTestId("neighbor-day")).toHaveLength(5)
    expect(screen.getByText("9/30")).toBeTruthy()

    // 見出しの横に、今の日のタイプと90日前のタイプ
    const header = screen.getByTestId("day-type-header")
    expect(header.textContent).toBe("日のタイプD490日前D3")

    // 日のタイプ（今と推移）
    const history = screen.getByRole("list", { name: "日のタイプの推移" })
    expect(history.textContent).toContain("90日前")
    expect(history.textContent).toContain("D3")
    expect(history.textContent).toContain("現在")
    expect(screen.getAllByText(/着地見込み 50〜65%・前年より5〜20%遅れ/).length).toBeGreaterThan(0)
    // アラート（AI の予測 B）と日のタイプ（D）のずれ・ペースの遅れをインサイトに出す
    expect(screen.getByText("予約の実数とAIの予測がずれています")).toBeTruthy()
    expect(screen.getByText("前年より予約の入りが遅れています")).toBeTruthy()
  })

  it("月の途中の日は前後の月を取りに行かない", () => {
    mocks.pricingCalendar.mockClear()
    const days = ["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"].map((d) => day(d))
    render(<DayAnalysisDialog day={days[2]} days={days} onClose={vi.fn()} />)
    expect(mocks.pricingCalendar).not.toHaveBeenCalled()
    expect(screen.getAllByTestId("neighbor-day")).toHaveLength(5)
    expect(screen.getByText("90日前より後に予約の記録が始まった日のため、推移はまだありません。")).toBeTruthy()
  })
})
