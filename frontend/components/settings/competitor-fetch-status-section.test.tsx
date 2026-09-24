import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

import { CompetitorFetchStatusSection } from "@/components/settings/competitor-fetch-status-section"

const mocks = vi.hoisted(() => ({ competitorFetchStatus: vi.fn() }))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, api: { competitorFetchStatus: mocks.competitorFetchStatus } }
})
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ hotelId: "hotel-a" }) }))

const recent = new Date(Date.now() - 3_600_000).toISOString()

describe("CompetitorFetchStatusSection（#9 段階C）", () => {
  beforeEach(() => mocks.competitorFetchStatus.mockReset())

  it("取得元ごとの状態を出し、連続失敗は理由も見せる", async () => {
    mocks.competitorFetchStatus.mockResolvedValue([
      {
        source: "rakuten",
        automated: true,
        competitorsWithUrl: 3,
        lastRun: { startedAt: recent, finishedAt: recent, status: "succeeded", observations: 270, errorMessage: null },
        lastSucceededAt: recent,
        consecutiveFailures: 0,
      },
      {
        source: "jalan",
        automated: true,
        competitorsWithUrl: 2,
        lastRun: { startedAt: recent, finishedAt: recent, status: "failed", observations: 0, errorMessage: "ページの構造が変わりました" },
        lastSucceededAt: null,
        consecutiveFailures: 2,
      },
      { source: "ikkyu", automated: false, competitorsWithUrl: 1, lastRun: null, lastSucceededAt: null, consecutiveFailures: 0 },
    ])
    render(<CompetitorFetchStatusSection />)

    await waitFor(() => expect(screen.getByText("楽天トラベル")).toBeTruthy())
    expect(mocks.competitorFetchStatus).toHaveBeenCalledWith("hotel-a")
    expect(screen.getByText("正常")).toBeTruthy()
    expect(screen.getByText("2回連続で失敗")).toBeTruthy()
    expect(screen.getByText("ページの構造が変わりました")).toBeTruthy()
    expect(screen.getByText("CSV で取り込み")).toBeTruthy()
  })

  it("取得に失敗したらエラーと再試行を出す", async () => {
    mocks.competitorFetchStatus.mockRejectedValue(new Error("network"))
    render(<CompetitorFetchStatusSection />)
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
  })
})
