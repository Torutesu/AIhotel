import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

import { PriceCalendarSection, summarizeCalendar } from "./price-calendar-section"
import { toOnHandRows } from "./on-hand-chart"
import type { PricingCalendarDay } from "@/lib/api"

// 日別価格カレンダー（2026-10 の画面修正 DP02 / DP04）

vi.mock("@/hooks/use-weekend", () => ({ useWeekend: () => ({ isWeekendDow: (d: number) => d === 5 || d === 6, weekendDays: [5, 6] }) }))

function day(date: string, overrides: Partial<PricingCalendarDay> = {}): PricingCalendarDay {
  return {
    date,
    demandLevel: "C",
    recommendedRank: 28,
    recommendedPrice: 16150,
    rankLabel: "R28",
    price1P: 16150,
    price2P: null,
    price3P: null,
    predictedOccupancy: 0.71,
    predictedAdr: 16150,
    actualOccupancy: null,
    actualAdr: null,
    competitorMedianPrice: null,
    competitorMinPrice: null,
    competitorMaxPrice: null,
    confidence: null,
    budgetRooms: 72,
    budgetOccupancy: 0.72,
    budgetAdr: 16383,
    budgetRevenue: 72 * 16383,
    onHandRooms: 31,
    currentOccupancy: 0.31,
    onHandAdr: null,
    currentRevenue: null,
    expectedRevenue: 71 * 16150,
    dayType: "A1",
    dayTypeExpectedOccupancy: 0.93,
    dayTypePaceRatio: 1.25,
    dayTypeHistory: [],
    ...overrides,
  }
}

const DAYS = [
  day("2026-12-01"),
  day("2026-12-02", { dayType: "D3", onHandRooms: 28, currentOccupancy: 0.28 }),
  day("2026-12-03", { actualAdr: 16453, actualOccupancy: 0.696, onHandAdr: 16453, onHandRooms: 70, currentOccupancy: 0.7, currentRevenue: 70 * 16453 }),
]

describe("summarizeCalendar", () => {
  it("予算・現在・AI の月計を出す（現在ADR は売上の分かる日だけ）", () => {
    const s = summarizeCalendar(DAYS, 100)
    expect(s.budgetRevenue).toBe(3 * 72 * 16383)
    expect(s.budgetAdr).toBeCloseTo(16383)
    expect(s.budgetOccupancy).toBeCloseTo(0.72)
    expect(s.currentOccupancy).toBeCloseTo((31 + 28 + 70) / 300)
    expect(s.currentRevenue).toBe(70 * 16453)
    expect(s.currentAdr).toBeCloseTo(16453)
    expect(s.predictedOccupancy).toBeCloseTo(0.71)
    expect(s.expectedAdr).toBeCloseTo(16150)
  })

  it("値の欠けた日は稼働率・ADR の分母に入れない（予約の記録・予測の無い日を 0室と数えない）", () => {
    const s = summarizeCalendar(
      [
        day("2026-12-01", { onHandRooms: 40, predictedOccupancy: 0.8, expectedRevenue: 80 * 15000 }),
        day("2026-12-02", { onHandRooms: null, predictedOccupancy: null, expectedRevenue: null }),
        day("2026-12-03", { onHandRooms: 60, predictedOccupancy: 0.6, expectedRevenue: null }),
      ],
      100,
    )
    expect(s.currentOccupancy).toBeCloseTo(0.5)
    expect(s.predictedOccupancy).toBeCloseTo(0.7)
    // 想定ADR は想定売上の分かる日（1日目）だけで出す
    expect(s.expectedAdr).toBeCloseTo(15000)
    expect(s.expectedRevenue).toBe(80 * 15000)
  })

  it("予算が未登録なら予算の月計は出さない", () => {
    const s = summarizeCalendar(
      DAYS.map((d) => ({ ...d, budgetRooms: null, budgetOccupancy: null, budgetAdr: null, budgetRevenue: null })),
      100,
    )
    expect(s.budgetAdr).toBeNull()
    expect(s.budgetOccupancy).toBeNull()
    expect(s.budgetRevenue).toBeNull()
  })
})

describe("toOnHandRows", () => {
  it("日・曜日とオンハンド・予算の値を並べる", () => {
    const rows = toOnHandRows(DAYS)
    expect(rows[0]).toMatchObject({ day: 1, dow: 2, label: "1（火）", onHandRooms: 31, budgetRooms: 72, budgetAdr: 16383 })
    expect(rows[2].onHandAdr).toBe(16453)
  })
})

describe("PriceCalendarSection", () => {
  it("DP02 の列（日のタイプ・予算・現在・想定）を並べ、結果・差異の列は出さない", () => {
    render(
      <PriceCalendarSection
        monthData={{ year: 2026, month: 12, calendar: DAYS }}
        totalRooms={100}
        highlightedDate={null}
        events={[]}
        onSelectRowForAnalysis={vi.fn()}
        onSelectDay={vi.fn()}
      />,
    )
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim())
    for (const label of ["日付", "曜日", "日のタイプ", "アラート", "予算ADR", "現在ADR", "推奨ADR", "予算稼働率", "現在稼働率", "稼働率予測（AI）", "推奨料金ランク", "予算売上", "現在売上", "想定売上"]) {
      expect(headers.some((h) => h?.startsWith(label)), label).toBe(true)
    }
    expect(headers.some((h) => h?.includes("ADR結果") || h?.includes("差異"))).toBe(false)
    expect(screen.getAllByLabelText(/日のタイプ A1/)).toHaveLength(2)
    expect(screen.getByLabelText(/日のタイプ D3/)).toBeTruthy()
    expect(screen.getByText("月計")).toBeTruthy()
    expect(screen.getByText("個人団体別 オンハンド状況")).toBeTruthy()
    expect(screen.queryByText("価格推移グラフ")).toBeNull()
  })
})
