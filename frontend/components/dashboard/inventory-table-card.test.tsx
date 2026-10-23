import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

import { InventoryTableCard } from "./inventory-table-card"
import { toDateStr } from "@/lib/date"

// 在庫表はダッシュボード下部（対象年月の数値）に置くため、対象年月を変えるとその月から表示する（2026-10-23 a01）

vi.mock("@/hooks/use-weekend", () => ({
  useWeekend: () => ({ weekendDays: [5, 6], isWeekendDow: (dow: number) => dow === 5 || dow === 6 }),
}))

describe("InventoryTableCard", () => {
  it("対象年月を変えるとその月の1日から（今月は今日から）表示し直し、手で動かした日もそのとき合わせる", () => {
    const now = new Date()
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const start = () => (screen.getByLabelText("対象日") as HTMLInputElement).value

    const { rerender } = render(<InventoryTableCard totalRooms={200} year={now.getFullYear()} month={now.getMonth() + 1} />)
    expect(start()).toBe(toDateStr(now))

    rerender(<InventoryTableCard totalRooms={200} year={next.getFullYear()} month={next.getMonth() + 1} />)
    expect(start()).toBe(toDateStr(next))

    // 手で14日進めても、対象年月を戻せば今日からに戻る
    fireEvent.click(screen.getByRole("button", { name: "次の14日" }))
    expect(start()).not.toBe(toDateStr(next))
    rerender(<InventoryTableCard totalRooms={200} year={now.getFullYear()} month={now.getMonth() + 1} />)
    expect(start()).toBe(toDateStr(now))
  })
})
