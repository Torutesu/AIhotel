import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import { DailyBudgetSection, monthDates, parseBudgetCell } from "@/components/settings/daily-budget-section"
import { toMonthStr } from "@/lib/date"

const mocks = vi.hoisted(() => ({
  dailyBudgets: vi.fn(),
  saveDailyBudgets: vi.fn(),
  auth: { hotelId: "h1", user: { role: "MANAGER" } as { role: string } },
}))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, api: { dailyBudgets: mocks.dailyBudgets, saveDailyBudgets: mocks.saveDailyBudgets } }
})
vi.mock("@/components/auth-provider", () => ({ useAuth: () => mocks.auth }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

const [year, month] = toMonthStr(new Date()).split("-").map(Number)
const first = monthDates(year, month)[0]

describe("DailyBudgetSection（D-13）", () => {
  beforeEach(() => {
    mocks.dailyBudgets.mockReset().mockResolvedValue([{ date: first, budgetRooms: 100, budgetRevenue: 1500000 }])
    mocks.saveDailyBudgets.mockReset().mockResolvedValue({ saved: 1, cleared: 1 })
    mocks.auth.user = { role: "MANAGER" }
  })

  it("変えた日だけを送り、両方空欄にした日は null・null（登録の解除）で送る", async () => {
    render(<DailyBudgetSection />)
    const rooms1 = await screen.findByLabelText(`${month}月1日の予算室数`)
    expect((rooms1 as HTMLInputElement).value).toBe("100")
    fireEvent.change(rooms1, { target: { value: "" } })
    fireEvent.change(screen.getByLabelText(`${month}月1日の予算売上`), { target: { value: "" } })
    fireEvent.change(screen.getByLabelText(`${month}月2日の予算室数`), { target: { value: "80" } })
    fireEvent.click(screen.getByRole("button", { name: "保存（2日）" }))
    await waitFor(() => expect(mocks.saveDailyBudgets).toHaveBeenCalled())
    expect(mocks.saveDailyBudgets).toHaveBeenCalledWith("h1", [
      { date: first, budgetRooms: null, budgetRevenue: null },
      { date: monthDates(year, month)[1], budgetRooms: 80, budgetRevenue: null },
    ])
  })

  it("オペレーターは読むだけ（入力欄と保存ボタンを出さない）", async () => {
    mocks.auth.user = { role: "OPERATOR" }
    render(<DailyBudgetSection />)
    expect(await screen.findByText("¥1,500,000")).toBeTruthy()
    expect(screen.queryByLabelText(`${month}月1日の予算室数`)).toBeNull()
    expect(screen.queryByRole("button", { name: /保存/ })).toBeNull()
  })

  it("入力の検証: 室数は0以上の整数、売上は0以上の数値", () => {
    expect(parseBudgetCell("", "rooms")).toEqual({ value: null })
    expect(parseBudgetCell("1,200", "revenue")).toEqual({ value: 1200 })
    expect(parseBudgetCell("1.5", "rooms").error).toBeTruthy()
    expect(parseBudgetCell("-1", "revenue").error).toBeTruthy()
  })
})
