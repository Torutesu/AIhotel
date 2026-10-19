import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

import { DailyVarianceTable } from "./daily-variance-table"
import type { DailyPerformanceDay, DayMetrics } from "@/lib/api"

// 日別パフォーマンスの表（2026-10 の画面修正）。行の選択と日付ボタン（料金設定へ移る）を別の操作にする

vi.mock("@/hooks/use-weekend", () => ({ useWeekend: () => ({ isWeekendDow: (d: number) => d === 5 || d === 6, weekendDays: [5, 6] }) }))

const metrics = (soldRooms: number, adr: number): DayMetrics => ({
  soldRooms,
  occupancy: soldRooms / 100,
  adr,
  revPar: (soldRooms * adr) / 100,
  revenue: soldRooms * adr,
})

const DAYS: DailyPerformanceDay[] = [
  { date: "2026-10-01", actual: metrics(80, 15000), budget: metrics(75, 14000), ai: metrics(78, 15000), lastYearDate: "2025-10-02", lastYear: metrics(70, 14000) },
  { date: "2026-10-02", actual: null, budget: metrics(75, 14000), ai: null, lastYearDate: "2025-10-03", lastYear: null },
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
})
