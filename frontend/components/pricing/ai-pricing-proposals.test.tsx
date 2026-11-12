import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

import { AiPricingProposals, parseProposals } from "@/components/pricing/ai-pricing-proposals"
import { AiOutlookCard, splitSections } from "@/components/external-demand/ai-outlook-card"

// AI価格最適化の提案・AI総合予測コメント（日次バッチが Claude API で作る — D-13）

const mocks = vi.hoisted(() => ({ aiSummary: vi.fn() }))
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, api: { aiSummary: mocks.aiSummary } }
})

describe("parseProposals / splitSections", () => {
  it("提案の JSON を読み、壊れた値は捨てる", () => {
    expect(parseProposals('[{"level":"high","text":"上げる"},{"level":"x","text":"?"},{"text":1}]')).toEqual([{ level: "high", text: "上げる" }])
    expect(parseProposals("壊れた")).toEqual([])
    expect(parseProposals(null)).toEqual([])
  })
  it("【見出し】ごとの段落に分ける", () => {
    expect(splitSections("【総合見通し】強い\n【注意事項】なし\n補足")).toEqual([
      { heading: "総合見通し", body: "強い" },
      { heading: "注意事項", body: "なし" },
      { heading: null, body: "補足" },
    ])
  })
})

describe("AiPricingProposals / AiOutlookCard", () => {
  beforeEach(() => mocks.aiSummary.mockReset())

  it("保存された提案を優先度つきで出し、無ければ案内を出す", async () => {
    mocks.aiSummary.mockResolvedValueOnce({
      id: "1",
      section: "pricing",
      content: JSON.stringify([{ level: "high", text: "12/5（金）はランクの引き上げを検討してください。" }]),
      generatedAt: "2026-11-13T06:00:00.000Z",
    })
    const { unmount } = render(<AiPricingProposals hotelId="h1" />)
    expect(await screen.findByText("12/5（金）はランクの引き上げを検討してください。")).toBeInTheDocument()
    expect(screen.getByText("レベル高")).toBeInTheDocument()
    expect(mocks.aiSummary).toHaveBeenCalledWith("h1", "pricing")
    unmount()

    mocks.aiSummary.mockResolvedValueOnce(null)
    render(<AiPricingProposals hotelId="h1" />)
    expect(await screen.findByText(/まだ AI の提案がありません/)).toBeInTheDocument()
  })

  it("総合コメントを見出しつきで出す", async () => {
    mocks.aiSummary.mockResolvedValueOnce({ id: "2", section: "external-outlook", content: "【総合見通し】年末年始は強い", generatedAt: "2026-11-13T06:00:00.000Z" })
    render(<AiOutlookCard hotelId="h1" />)
    expect(await screen.findByText("年末年始は強い")).toBeInTheDocument()
    expect(screen.getByText("【総合見通し】")).toBeInTheDocument()
    expect(mocks.aiSummary).toHaveBeenCalledWith("h1", "external-outlook")
  })
})
