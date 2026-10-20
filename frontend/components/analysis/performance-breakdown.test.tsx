import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"

import { formatTargetDates, performanceYoy } from "./performance-breakdown-table"
import { WeekdayPerformanceSection } from "./weekday-performance-section"
import { DayTypePerformanceSection } from "./day-type-performance-section"
import type { PerformanceRow } from "@/lib/api"

// 曜日別・日のタイプ別パフォーマンス（2026-10 PDF c分析01実績推移2）:
// 前月以前は実績、当月以降は 実績＋予約。項目は 販売室数〜前年比。日のタイプは行のクリックで対象日を出す

const mocks = vi.hoisted(() => ({ dayOfWeekBreakdown: vi.fn(), dayTypeBreakdown: vi.fn() }))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, api: { ...actual.api, ...mocks } }
})
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ hotelId: "hotel-a" }) }))
vi.mock("@/components/app-state-provider", () => ({ usePeriod: () => ({ year: 2026, month: 11 }) }))

const row = (overrides: Partial<PerformanceRow> = {}): PerformanceRow => ({
  days: 2,
  actualDays: 1,
  soldRooms: 150,
  onHandRooms: 60,
  revenue: 1_620_000,
  occupancy: 0.75,
  adr: 18000,
  revPar: 16200,
  lastYear: { days: 2, soldRooms: 160, revenue: 2_880_000, occupancy: 0.8, adr: 18000 },
  dates: ["2026-11-02", "2026-11-09"],
  ...overrides,
})

describe("formatTargetDates / performanceYoy", () => {
  it("対象日を 2(月)・9(月) のように出す", () => {
    expect(formatTargetDates(["2026-11-02", "2026-11-09"])).toBe("2(月)・9(月)")
  })

  it("販売室数・稼働率は 実績＋予約 で前年と比べ、ADR・売上は予約の日を含む行では比べない", () => {
    const yoy = performanceYoy(row())
    expect(yoy.soldRooms).toBeCloseTo(150 / 160 - 1)
    expect(yoy.occupancy).toBeCloseTo(-0.05)
    expect(yoy.adr).toBeNull()
    expect(yoy.revenue).toBeNull()
    const done = performanceYoy(row({ actualDays: 2, onHandRooms: 0, adr: 19800, revenue: 2_970_000 }))
    expect(done.adr).toBeCloseTo(0.1)
    expect(done.revenue).toBeCloseTo(2_970_000 / 2_880_000 - 1)
  })
})

describe("WeekdayPerformanceSection / DayTypePerformanceSection", () => {
  beforeEach(() => {
    mocks.dayOfWeekBreakdown.mockReset().mockResolvedValue({
      hotelId: "hotel-a",
      year: 2026,
      month: 11,
      days: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        dayOfWeek,
        isWeekend: dayOfWeek === 5 || dayOfWeek === 6,
        ...(dayOfWeek === 1 ? row() : row({ days: 0, actualDays: 0, soldRooms: 0, onHandRooms: 0, revenue: 0, occupancy: null, adr: null, revPar: null, lastYear: null, dates: [] })),
      })),
    })
    mocks.dayTypeBreakdown.mockReset().mockResolvedValue({
      hotelId: "hotel-a",
      year: 2026,
      month: 11,
      untypedDays: 1,
      types: [{ dayType: "平日A型", model: "balanced", ...row() }],
    })
  })

  it("曜日別は 販売室数（うち予約）〜前年比 を出す", async () => {
    render(<WeekdayPerformanceSection />)
    const table = await screen.findByTestId("weekday-performance-table")
    expect(mocks.dayOfWeekBreakdown).toHaveBeenCalledWith("hotel-a", 2026, 11)
    expect(within(table).getByText("販売室数（うち予約）")).toBeTruthy()
    const monday = within(table).getByRole("button", { name: "月曜日の対象日を表示" })
    const cells = within(monday).getAllByRole("cell").map((c) => c.textContent)
    expect(cells.slice(1, 4)).toEqual(["2日", "150室（60室）", "75.0%"])
    // 前年比: 販売室数 −6.3%、稼働率 −5.0%、ADR・売上は予約の日を含むので出さない
    expect(cells.slice(7)).toEqual(["-6.3%", "-5.0%", "-", "-"])
  })

  it("日のタイプ別は型の名前で並べ、行のクリックで対象日を出す", async () => {
    render(<DayTypePerformanceSection />)
    const table = await screen.findByTestId("day-type-performance-table")
    expect(within(table).getByText("平日A型")).toBeTruthy()
    expect(within(table).getByText("バランス")).toBeTruthy()
    fireEvent.click(within(table).getByRole("button", { name: "平日A型の対象日を表示" }))
    await waitFor(() => expect(screen.getByTestId("breakdown-dates").textContent).toContain("2(月)・9(月)"))
    expect(screen.getByTestId("breakdown-dates").textContent).toContain("うち予約の日 1日")
    expect(screen.getByText(/型を決められなかった日（1日）/)).toBeTruthy()
  })
})
