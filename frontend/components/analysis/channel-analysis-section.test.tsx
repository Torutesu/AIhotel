import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"

import { ChannelAnalysisSection } from "@/components/analysis/channel-analysis-section"
import { topWithOthers, type CompositionRow } from "@/components/analysis/composition-view"

// 需要構成のチャネル別（#88。2026-10 PDF c分析02: 前年同月比、上位10社＋その他、3つの切り口で同じ表）

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
// recharts は jsdom では大きさが取れないため、グラフの枠だけ出す
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>()
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div style={{ width: 400, height: 200 }}>{children}</div> }
})

const channel = (name: string, roomsSold: number, revenue: number, revenueYoy: number | null) => ({
  channel: name,
  roomsSold,
  revenue,
  adr: Math.round(revenue / roomsSold),
  occupancy: roomsSold / 3000,
  revenueShare: 0,
  roomsShare: 0,
  lastYearRoomsSold: null,
  lastYearRevenue: revenueYoy == null ? null : Math.round(revenue / (1 + revenueYoy / 100)),
  revenueYoy,
})

describe("ChannelAnalysisSection", () => {
  beforeEach(() => mocks.channelBreakdown.mockReset())

  it("対象月の実データを 販売室数〜前年同月比 の表で出し、前月比は出さない", async () => {
    mocks.channelBreakdown.mockResolvedValue({
      hotelId: "hotel-a",
      year: 2026,
      month: 8,
      totalRooms: 100,
      days: 30,
      channels: [
        { ...channel("公式サイト", 120, 2_400_000, 12.5), revenueShare: 60, roomsShare: 54.5 },
        { ...channel("楽天トラベル", 100, 1_600_000, null), revenueShare: 40, roomsShare: 45.5 },
      ],
    })
    render(<ChannelAnalysisSection targetPeriod="2026-08" />)

    const table = await screen.findByTestId("channel-composition-table")
    expect(mocks.channelBreakdown).toHaveBeenCalledWith("hotel-a", 2026, 8)
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent)
    expect(headers).toEqual(["チャネル", "販売室数", "稼働率", "ADR", "客単価", "室料売上", "売上構成比", "DOR", "平均宿泊数", "前年同月比"])
    expect(within(table).getByText("+12.5%")).toBeTruthy()
    expect(screen.queryByText(/前月比/)).toBeNull()
    expect(screen.getByTestId("share-rooms")).toBeTruthy()
    expect(screen.getByTestId("share-revenue")).toBeTruthy()
    // 区分ごとの月のブッキングカーブはサンプルと明示する
    expect(within(screen.getByTestId("segment-month-curve")).getAllByText(/サンプル/).length).toBeGreaterThan(0)
  })

  it("11社目以降は「その他」にまとめる", async () => {
    mocks.channelBreakdown.mockResolvedValue({
      hotelId: "hotel-a",
      year: 2026,
      month: 8,
      totalRooms: 100,
      days: 30,
      channels: Array.from({ length: 13 }, (_, i) => channel(`チャネル${i + 1}`, 100 - i, (100 - i) * 15000, 5)),
    })
    render(<ChannelAnalysisSection targetPeriod="2026-08" />)
    const table = await screen.findByTestId("channel-composition-table")
    expect(within(table).getAllByRole("row")).toHaveLength(1 + 10 + 1)
    expect(within(table).getByText("その他（3社）")).toBeTruthy()
    expect(screen.getByText(/全13社/)).toBeTruthy()
  })

  it("実績が無い月は空状態を出す", async () => {
    mocks.channelBreakdown.mockResolvedValue({ hotelId: "hotel-a", year: 2026, month: 8, totalRooms: 100, days: 0, channels: [] })
    render(<ChannelAnalysisSection targetPeriod="2026-08" />)
    await waitFor(() => expect(screen.getByText(/チャネル別の実績はまだありません/)).toBeTruthy())
  })
})

describe("topWithOthers", () => {
  const row = (key: string, soldRooms: number, revenue: number, lastYearRevenue: number | null): CompositionRow => ({
    key,
    name: key,
    soldRooms,
    occupancy: soldRooms / 1000,
    adr: revenue / soldRooms,
    guestUnitPrice: null,
    revenue,
    revenueShare: 10,
    roomsShare: 10,
    dor: null,
    avgNights: null,
    yoy: null,
    lastYearRevenue,
  })

  it("残りを1行に足し上げ、ADR・前年同月比は合計から出し直す", () => {
    const rows = topWithOthers([row("a", 50, 1_000_000, 900_000), row("b", 20, 300_000, 200_000), row("c", 10, 100_000, 50_000)], 1, "社", true)
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({ name: "その他（2社）", soldRooms: 30, revenue: 400_000, adr: 13333, revenueShare: 20, roomsShare: 20 })
    expect(rows[1].occupancy).toBeCloseTo(0.03)
    expect(rows[1].yoy).toBeCloseTo(60)
  })

  it("前年の値が1つでも欠けていれば前年同月比は出さない", () => {
    const rows = topWithOthers([row("a", 50, 1, 1), row("b", 20, 300, null), row("c", 10, 100, 50)], 1, "社")
    expect(rows[1].yoy).toBeNull()
    expect(rows[1].occupancy).toBeNull()
  })
})
