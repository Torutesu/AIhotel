import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

import { ChannelAnalysisSection } from "@/components/analysis/channel-analysis-section"

const mocks = vi.hoisted(() => ({ channelBreakdown: vi.fn() }))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, api: { channelBreakdown: mocks.channelBreakdown } }
})
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ hotelId: "hotel-a" }) }))
// targetPeriod を props で渡すので、共有の対象年月（URL 同期）は使われない
vi.mock("@/components/app-state-provider", () => ({
  usePeriod: () => ({ periodMonth: "2026-09", setPeriodMonth: vi.fn() }),
}))

describe("ChannelAnalysisSection（#88）", () => {
  beforeEach(() => mocks.channelBreakdown.mockReset())

  it("対象月の実データを表示し、サンプルの注記を出さない", async () => {
    mocks.channelBreakdown.mockResolvedValue({
      hotelId: "hotel-a",
      year: 2026,
      month: 8,
      channels: [
        { channel: "公式サイト", roomsSold: 120, revenue: 2_400_000, adr: 20_000, revenueShare: 60, revenueGrowth: 12.5 },
        { channel: "楽天トラベル", roomsSold: 100, revenue: 1_600_000, adr: 16_000, revenueShare: 40, revenueGrowth: null },
      ],
    })
    render(<ChannelAnalysisSection targetPeriod="2026-08" />)

    await waitFor(() => expect(screen.getAllByText("公式サイト").length).toBeGreaterThan(0))
    expect(mocks.channelBreakdown).toHaveBeenCalledWith("hotel-a", 2026, 8)
    expect(screen.getAllByText("+12.5%").length).toBeGreaterThan(0)
    expect(screen.queryByText(/サンプル/)).toBeNull()
  })

  it("実績が無い月は空状態を出す", async () => {
    mocks.channelBreakdown.mockResolvedValue({ hotelId: "hotel-a", year: 2026, month: 8, channels: [] })
    render(<ChannelAnalysisSection targetPeriod="2026-08" />)
    await waitFor(() => expect(screen.getByText(/チャネル別の実績はまだありません/)).toBeTruthy())
  })
})
