import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

import { FreeAnalysisSection, formatFreeValue } from "./free-analysis-section"

// フリー分析（D-13 — 予約明細から GET /analysis/free）

const freeAnalysis = vi.fn()
vi.mock("@/components/app-state-provider", () => ({ usePeriod: () => ({ periodMonth: "2026-12", setPeriodMonth: vi.fn() }) }))
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ hotelId: "h1" }) }))
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: { freeAnalysis: (...a: unknown[]) => freeAnalysis(...a) },
}))

describe("FreeAnalysisSection", () => {
  it("軸と項目を選ぶまでは集計しない。サンプルの注記は出さない", () => {
    render(<FreeAnalysisSection />)
    expect(screen.getByText("分析軸1と集計項目を選択して分析を開始してください")).toBeTruthy()
    expect(freeAnalysis).not.toHaveBeenCalled()
    expect(screen.queryByText(/サンプル/)).toBeNull()
  })

  it("集計項目に合わせて表示する（室料の無い値は —）", () => {
    expect(formatFreeValue("occupancy", 52.5)).toBe("52.5%")
    expect(formatFreeValue("adr", 18000)).toBe("¥18,000")
    expect(formatFreeValue("rooms", 1200)).toBe("1,200室")
    expect(formatFreeValue("bookings", 3)).toBe("3件")
    expect(formatFreeValue("revenue", null)).toBe("—")
  })
})
