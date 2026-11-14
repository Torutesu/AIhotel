import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

import { parseAnalysisInsights } from "./analysis-insights"
import { DailyAiInsightSection } from "./daily-ai-insight-section"
import { CompositionInsightSection } from "./composition-insight-section"

// 分析タブのインサイト（D-13 — 日次バッチが Claude API で当月について作る）

const aiSummary = vi.fn()
vi.mock("@/components/app-state-provider", () => ({ usePeriod: () => ({ periodMonth: "2026-11", setPeriodMonth: vi.fn() }) }))
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ hotelId: "h1" }) }))
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: { aiSummary: (...a: unknown[]) => aiSummary(...a) },
}))

const content = JSON.stringify({
  year: 2026,
  month: 11,
  segments: [
    { segment: "利用人数", text: "2名利用が過半です。" },
    { segment: "天気", text: "知らない切り口は捨てる" },
  ],
  composition: ["公式サイトが伸びています。"],
  leadTime: [],
})

describe("parseAnalysisInsights", () => {
  it("知らない切り口・壊れた JSON を捨てる", () => {
    expect(parseAnalysisInsights(content)?.segments).toEqual([{ segment: "利用人数", text: "2名利用が過半です。" }])
    expect(parseAnalysisInsights("{")).toBeNull()
    expect(parseAnalysisInsights(JSON.stringify({ segments: [] }))).toBeNull()
  })
})

describe("分析インサイト・需要構成インサイト", () => {
  beforeEach(() => aiSummary.mockReset())

  it("当月のインサイトを出す", async () => {
    aiSummary.mockResolvedValue({ id: "x", section: "analysis-insights", content, generatedAt: "2026-11-12T06:00:00+09:00" })
    render(
      <>
        <DailyAiInsightSection />
        <CompositionInsightSection />
      </>,
    )
    expect(await screen.findByText("2名利用が過半です。")).toBeTruthy()
    expect(screen.getByText("公式サイトが伸びています。")).toBeTruthy()
    expect(aiSummary).toHaveBeenCalledWith("h1", "analysis-insights")
    expect(screen.queryByText(/サンプル/)).toBeNull()
  })

  it("別の月を見ているときは文章を出さない", async () => {
    aiSummary.mockResolvedValue({ id: "x", section: "analysis-insights", content, generatedAt: "2026-11-12T06:00:00+09:00" })
    render(<DailyAiInsightSection targetPeriod="2026-10" />)
    expect(await screen.findByTestId("insight-other-month")).toBeTruthy()
    expect(screen.queryByText("2名利用が過半です。")).toBeNull()
  })

  it("まだ作られていなければそう書く", async () => {
    aiSummary.mockResolvedValue(null)
    render(<CompositionInsightSection />)
    expect(await screen.findByText(/まだ AI のインサイトがありません/)).toBeTruthy()
  })
})
