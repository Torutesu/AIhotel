import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"

import { DailyVarianceTable } from "./daily-variance-table"
import type { DailyPerformanceDay, DayMetrics } from "@/lib/api"

// 日別パフォーマンスの表（2026-10 の画面修正）。行の選択と日付ボタン（料金設定へ移る）を別の操作にする。
// 実数と想定値で見る（PDF c分析01実績推移2）: 過去は実績、先の日は予約実数。項目ごとに 実数・想定・予算・予算差異

vi.mock("@/hooks/use-weekend", () => ({ useWeekend: () => ({ isWeekendDow: (d: number) => d === 5 || d === 6, weekendDays: [5, 6] }) }))

const metrics = (soldRooms: number, adr: number): DayMetrics => ({
  soldRooms,
  occupancy: soldRooms / 100,
  adr,
  revPar: (soldRooms * adr) / 100,
  revenue: soldRooms * adr,
})

const onHand = (soldRooms: number): DayMetrics => ({ soldRooms, occupancy: soldRooms / 100, adr: null, revPar: null, revenue: null })

const DAYS: DailyPerformanceDay[] = [
  { date: "2026-10-01", actual: metrics(80, 15000), onHand: null, budget: metrics(75, 14000), ai: metrics(78, 15000), lastYearDate: "2025-10-02", lastYear: metrics(70, 14000) },
  { date: "2026-10-02", actual: null, onHand: onHand(40), budget: metrics(75, 14000), ai: metrics(70, 14500), lastYearDate: "2025-10-03", lastYear: null },
]

function renderTable() {
  const onSelectDate = vi.fn()
  const onNavigateToPricing = vi.fn()
  render(
    <DailyVarianceTable days={DAYS} totalRooms={100} month={10} selectedDate={null} onSelectDate={onSelectDate} onNavigateToPricing={onNavigateToPricing} />,
  )
  return { onSelectDate, onNavigateToPricing }
}

describe("DailyVarianceTable", () => {
  it("行のクリック・Enter で日を選ぶ", () => {
    const { onSelectDate, onNavigateToPricing } = renderTable()
    const row = screen.getByRole("button", { name: "10/1を選んで日のグラフを表示" })
    fireEvent.click(row)
    fireEvent.keyDown(row, { key: "Enter" })
    expect(onSelectDate).toHaveBeenCalledTimes(2)
    expect(onSelectDate).toHaveBeenCalledWith("2026-10-01")
    expect(onNavigateToPricing).not.toHaveBeenCalled()
  })

  it("日付ボタンでの Enter は行の選択にしない（ボタンのクリックで料金設定へ移る）", () => {
    const { onSelectDate, onNavigateToPricing } = renderTable()
    const dateButton = screen.getByTitle("10/1 のダイナミックプライシングを開く")
    const notPrevented = fireEvent.keyDown(dateButton, { key: "Enter" })
    expect(notPrevented).toBe(true)
    expect(onSelectDate).not.toHaveBeenCalled()
    fireEvent.click(dateButton)
    expect(onNavigateToPricing).toHaveBeenCalledWith(new Date(2026, 9, 1))
    expect(onSelectDate).not.toHaveBeenCalled()
  })

  it("実数と想定値で見る: 過去は実績、先の日は予約実数を出し、予算差異は 結果（先の日は想定）− 予算", () => {
    renderTable()
    const table = screen.getByTestId("daily-figures-table")
    expect(within(table).getByText("想定販売数")).toBeTruthy()
    expect(within(table).getByText("想定稼働率")).toBeTruthy()
    const future = screen.getByRole("button", { name: "10/2を選んで日のグラフを表示" })
    const cells = within(future).getAllByRole("cell").map((c) => c.textContent)
    // 日付・曜日・区分・販売室数（実数・想定・予算・予算差異）・稼働率（同）
    expect(cells.slice(2, 11)).toEqual(["予約", "40室", "70室", "75室", "-5室", "40.0%", "70.0%", "75.0%", "-5.0%"])
    // 予約の単価・売上はまだ無い
    expect(cells[11]).toBe("-")
    // 月計は 実績＋予約（80 + 40 室）
    expect(within(table).getByText("月計（実績1日＋予約1日）")).toBeTruthy()
    expect(screen.getByText(/予約の単価・売上は PMS 連携後に表示します/)).toBeTruthy()
  })

  it("差異で見るに切り替えると、予算差異・AI想定差異・前年比を出す（稼働率は % 表記）", () => {
    renderTable()
    fireEvent.click(screen.getByRole("button", { name: "差異で見る" }))
    const table = screen.getByTestId("daily-variance-table")
    expect(within(table).getByText("AI想定差異")).toBeTruthy()
    const past = screen.getByRole("button", { name: "10/1を選んで日のグラフを表示" })
    const cells = within(past).getAllByRole("cell").map((c) => c.textContent)
    // 予算差異の稼働率 80% − 75%
    expect(cells[8]).toBe("+5.0%")
    const future = screen.getByRole("button", { name: "10/2を選んで日のグラフを表示" })
    expect(within(future).getAllByRole("cell")[3].textContent).toBe("40室")
  })
})
