import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

import { SetupChecklistCard } from "@/components/onboarding/setup-checklist-card"

const mocks = vi.hoisted(() => ({ hotelSetupStatus: vi.fn(), setTab: vi.fn() }))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, api: { hotelSetupStatus: mocks.hotelSetupStatus } }
})
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ hotelId: "h1" }) }))
vi.mock("@/components/app-state-provider", () => ({ useAppState: () => ({ setTab: mocks.setTab }) }))

describe("SetupChecklistCard（#13）", () => {
  beforeEach(() => {
    mocks.hotelSetupStatus.mockReset()
    mocks.setTab.mockReset()
  })

  it("必須項目が未完了なら進み具合と未完了の理由を出し、設定タブへ移動できる", async () => {
    mocks.hotelSetupStatus.mockResolvedValue({
      hotelId: "h1",
      ready: false,
      items: [
        { key: "basic", label: "ホテルタイプとマーケット", required: true, done: true, detail: null },
        { key: "competitors", label: "競合ホテル", required: true, done: false, detail: "競合が 1 社です（3 社以上必要）" },
        { key: "budget", label: "月次予算（今月から12か月）", required: false, done: false, detail: "予算が登録されている月は 0 か月です" },
      ],
    })
    render(<SetupChecklistCard />)
    expect(await screen.findByText("初期設定が完了していません（1/2）")).toBeTruthy()
    expect(screen.getByText("競合が 1 社です（3 社以上必要）")).toBeTruthy()
    expect(screen.getByText("（任意）")).toBeTruthy()
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50")
    fireEvent.click(screen.getByRole("button", { name: "設定タブを開く" }))
    expect(mocks.setTab).toHaveBeenCalledWith("settings")
  })

  it("必須項目がすべて揃っていれば何も表示しない", async () => {
    mocks.hotelSetupStatus.mockResolvedValue({ hotelId: "h1", ready: true, items: [] })
    const { container } = render(<SetupChecklistCard />)
    await vi.waitFor(() => expect(mocks.hotelSetupStatus).toHaveBeenCalled())
    expect(container.textContent).toBe("")
  })
})
