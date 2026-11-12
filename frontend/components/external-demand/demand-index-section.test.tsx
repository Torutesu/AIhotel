import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"

import { DemandIndexSection, componentsSummary, signalLabel } from "@/components/external-demand/demand-index-section"
import { mockDemandIndex } from "@/lib/api/demo-external-signals"

const mocks = vi.hoisted(() => ({ demandIndex: vi.fn() }))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, api: { demandIndex: mocks.demandIndex } }
})
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ hotelId: "h1" }) }))

// デモのサンプル（2026年11月から6か月）で描画する
const SAMPLE = mockDemandIndex(6, new Date(2026, 10, 12))

describe("DemandIndexSection（D-13）", () => {
  beforeEach(() => mocks.demandIndex.mockReset())

  it("6か月の月ごとの内訳と basis の注記を出す。季節は内訳の中だけで、グラフの下に季節のチップを並べない", async () => {
    mocks.demandIndex.mockResolvedValue(SAMPLE)
    render(<DemandIndexSection />)
    const list = await screen.findByRole("list", { name: "月ごとの内訳" })
    expect(mocks.demandIndex).toHaveBeenCalledWith("h1", 6)
    expect(within(list).getAllByRole("listitem").filter((li) => li.querySelector("details"))).toHaveLength(6)
    expect(within(list).getByText("2026年11月")).toBeTruthy()
    expect(within(list).getByText("2027年4月")).toBeTruthy()
    expect(screen.getByText(SAMPLE.basis)).toBeTruthy()
    // 季節カレンダーのカードは作らない
    expect(screen.queryByText(/季節カレンダー/)).toBeNull()

    // 1月の内訳を開くと季節（年末年始・受験）が出る
    const jan = within(list).getByText("2027年1月").closest("details") as HTMLDetailsElement
    fireEvent.click(within(jan).getByText("2027年1月"))
    expect(jan.textContent).toContain("年末年始・受験")
  })

  it("内訳の文言: 季節が出せない月は平均とみなす。市場の動きは種類・向き・大きさ", () => {
    const m = { ...SAMPLE.months[0], components: { seasonal: null, events: 3, market: -1.5 } }
    expect(componentsSummary(m)).toBe("季節 100（前年の実績が足りないため平均とみなす）・イベント +3.0・市場の動き −1.5")
    expect(signalLabel({ kind: "inbound", title: "増便", direction: "up", magnitude: "high" })).toBe("インバウンド: 増便（上向き・影響 大）")
  })

  it("取得に失敗したらエラーと再試行", async () => {
    mocks.demandIndex.mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce(SAMPLE)
    render(<DemandIndexSection />)
    expect(await screen.findByText("月別需要指数の取得に失敗しました")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "再試行" }))
    expect(await screen.findByRole("list", { name: "月ごとの内訳" })).toBeTruthy()
  })
})
