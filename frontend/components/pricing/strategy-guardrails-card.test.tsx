import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import { StrategyGuardrailsCard, validateGuardrailForm } from "@/components/pricing/strategy-guardrails-card"
import { RationaleSection } from "@/components/pricing/day-detail-dialog"
import type { PricingStrategy, RecommendationRationale } from "@/lib/api"

const mocks = vi.hoisted(() => ({
  role: "MANAGER" as string,
  pricingStrategy: vi.fn(),
  updatePricingStrategy: vi.fn(),
  pricingLocks: vi.fn(),
  createPricingLock: vi.fn(),
  deletePricingLock: vi.fn(),
}))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    api: {
      pricingStrategy: mocks.pricingStrategy,
      updatePricingStrategy: mocks.updatePricingStrategy,
      pricingLocks: mocks.pricingLocks,
      createPricingLock: mocks.createPricingLock,
      deletePricingLock: mocks.deletePricingLock,
    },
  }
})
vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ hotelId: "h1", user: { role: mocks.role } }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const STRATEGY: PricingStrategy = {
  id: "s1",
  hotelId: "h1",
  weightOccupancy: 50,
  weightAdr: 30,
  weightCompetitor: 20,
  competitorOccupancy: null,
  competitorOffsetPct: 0,
  minRank: null,
  maxRank: null,
  maxDailyRankChange: 3,
  hysteresisRanks: 1,
}

const baseForm = {
  competitorOccupancy: "" as const,
  competitorOffsetPct: "0",
  minRank: "",
  maxRank: "",
  maxDailyRankChange: "3",
  hysteresisRanks: "1",
}

describe("validateGuardrailForm（#17）", () => {
  it("範囲外・下限＞上限を弾き、空欄は制限なしとして通す", () => {
    expect(validateGuardrailForm(baseForm)).toBeNull()
    expect(validateGuardrailForm({ ...baseForm, competitorOffsetPct: "31" })).toContain("-30〜+30")
    expect(validateGuardrailForm({ ...baseForm, minRank: "41" })).toContain("1〜40")
    expect(validateGuardrailForm({ ...baseForm, minRank: "10", maxRank: "5" })).toContain("下限は上限以下")
    expect(validateGuardrailForm({ ...baseForm, hysteresisRanks: "6" })).toContain("0〜5")
    expect(validateGuardrailForm({ ...baseForm, maxDailyRankChange: "" })).toBeNull()
  })
})

describe("StrategyGuardrailsCard（#17）", () => {
  beforeEach(() => {
    mocks.role = "MANAGER"
    Object.values(mocks).forEach((m) => typeof m === "function" && m.mockReset())
    mocks.pricingStrategy.mockResolvedValue(STRATEGY)
    mocks.pricingLocks.mockResolvedValue([])
  })

  it("保存では重みを送らない（重みのカードで保存した値を古い値で上書きしない）", async () => {
    mocks.updatePricingStrategy.mockResolvedValue({ ...STRATEGY, minRank: 5 })
    render(<StrategyGuardrailsCard />)
    fireEvent.change(await screen.findByLabelText("推奨ランクの下限"), { target: { value: "5" } })
    fireEvent.click(screen.getByRole("button", { name: /保存/ }))
    await waitFor(() => expect(mocks.updatePricingStrategy).toHaveBeenCalled())
    const [hotelId, input] = mocks.updatePricingStrategy.mock.calls[0]
    expect(hotelId).toBe("h1")
    expect(input).toMatchObject({ minRank: 5, maxDailyRankChange: 3, competitorOccupancy: null })
    expect(input).not.toHaveProperty("weightOccupancy")
  })

  it("入力が不正なら保存できずエラーを出す", async () => {
    render(<StrategyGuardrailsCard />)
    fireEvent.change(await screen.findByLabelText("競合との価格差（%）"), { target: { value: "50" } })
    expect(screen.getByRole("alert").textContent).toContain("-30〜+30")
    expect((screen.getByRole("button", { name: /保存/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("オペレーターは閲覧のみで、保存ボタンも期間の追加欄も出ない", async () => {
    mocks.role = "OPERATOR"
    mocks.pricingLocks.mockResolvedValue([{ id: "l1", hotelId: "h1", startDate: "2026-10-01", endDate: "2026-10-02", reason: "団体" }])
    render(<StrategyGuardrailsCard />)
    expect(await screen.findByText(/団体/)).toBeTruthy()
    expect(((await screen.findByLabelText("推奨ランクの下限")) as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole("button", { name: /保存/ })).toBeNull()
    expect(screen.queryByRole("button", { name: "追加" })).toBeNull()
  })

  it("固定期間を追加すると一覧に出る", async () => {
    mocks.createPricingLock.mockResolvedValue({ id: "l2", hotelId: "h1", startDate: "2026-11-01", endDate: "2026-11-03", reason: null })
    render(<StrategyGuardrailsCard />)
    fireEvent.change(await screen.findByLabelText("開始日"), { target: { value: "2026-11-01" } })
    fireEvent.change(screen.getByLabelText("終了日"), { target: { value: "2026-11-03" } })
    fireEvent.click(screen.getByRole("button", { name: "追加" }))
    expect(await screen.findByText(/2026-11-01 〜 2026-11-03/)).toBeTruthy()
    expect(mocks.createPricingLock).toHaveBeenCalledWith({ hotelId: "h1", startDate: "2026-11-01", endDate: "2026-11-03", reason: undefined })
  })
})

describe("RationaleSection（#24 E4）", () => {
  it("観点ごとのランクと重み、使わなかった観点の理由、かかった調整を出す", () => {
    const rationale: RecommendationRationale = {
      version: 1,
      modelVersion: "rule-based-v3",
      recommendedRank: 7,
      factors: [
        { key: "occupancy", rank: 6, weight: 60, input: { predictedOccupancy: 0.7 } },
        { key: "adr", rank: 9, weight: 40, input: { baseAdr: 15000 } },
      ],
      adjustments: [{ key: "weekend", impact: 0.05 }],
      excluded: [{ key: "competitor", reason: "stale" }],
      guardrails: [{ key: "maxDailyChange", from: 10, to: 7 }],
    }
    render(<RationaleSection rationale={rationale} />)
    expect(screen.getByText("稼働率から見たランク：6")).toBeTruthy()
    expect(screen.getByText("重み 40%")).toBeTruthy()
    expect(screen.getByText(/競合価格：取得から48時間を超えて古い/)).toBeTruthy()
    expect(screen.getByText(/週末 \+5pt/)).toBeTruthy()
    expect(screen.getByText(/1回の変動幅でランク10→7/)).toBeTruthy()
  })
})
