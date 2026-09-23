import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import type { PricingSimulation } from "@/lib/api"
import { LandingForecastSummary } from "@/components/pricing/landing-forecast-summary"

const mocks = vi.hoisted(() => ({
  pricingSimulation: vi.fn(),
  recomputeForecast: vi.fn(),
  recomputeSimulation: vi.fn(),
  role: "MANAGER" as string,
}))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    api: {
      pricingSimulation: mocks.pricingSimulation,
      recomputeForecast: mocks.recomputeForecast,
      recomputeSimulation: mocks.recomputeSimulation,
    },
  }
})

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ hotelId: "hotel-a", user: { role: mocks.role } }),
}))

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// 再計算できるのは本日以降なので、対象月は必ず未来にする
const YEAR = new Date().getFullYear() + 1
const MONTH = 3

const EMPTY: PricingSimulation = { simulation: null, budget: null }

const GENERATED: PricingSimulation = {
  budget: null,
  simulation: {
    id: "sim-1",
    hotelId: "hotel-a",
    year: YEAR,
    month: MONTH,
    projectedRevenue: 12_000_000,
    projectedRooms: 400,
    projectedAdr: 30_000,
    projectedOccupancy: 0.8,
    projectedRevPar: 24_000,
    computedAt: "2026-09-23T00:00:00.000Z",
  },
}

function renderSummary() {
  return render(
    <LandingForecastSummary
      year={YEAR}
      month={MONTH}
      current={{ adr: null, occupancy: null, revPar: null }}
      currentLoading={false}
    />
  )
}

describe("LandingForecastSummary（AI予測値へリセット — #77）", () => {
  beforeEach(() => {
    mocks.role = "MANAGER"
    mocks.pricingSimulation.mockReset()
    mocks.recomputeForecast.mockReset()
    mocks.recomputeSimulation.mockReset()
    mocks.recomputeForecast.mockResolvedValue({
      count: 31,
      modelVersion: "rule-based-v2",
      startDate: `${YEAR}-03-01`,
      endDate: `${YEAR}-03-31`,
    })
    mocks.recomputeSimulation.mockResolvedValue({ simulation: GENERATED.simulation, actualDays: 0, predictedDays: 31 })
  })

  it("リセットすると需要予測に続けて表示中の月の着地予測も再計算し、結果を表示する", async () => {
    mocks.pricingSimulation.mockResolvedValueOnce(EMPTY).mockResolvedValueOnce(GENERATED)
    renderSummary()

    await waitFor(() => expect(screen.getByText("この月の着地予測はまだ生成されていません。")).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: /AI予測値へリセット/ }))
    fireEvent.click(await screen.findByRole("button", { name: "リセットする" }))

    await waitFor(() => expect(mocks.recomputeSimulation).toHaveBeenCalledWith("hotel-a", YEAR, MONTH))
    expect(mocks.recomputeForecast).toHaveBeenCalledTimes(1)
    // 需要予測 → 着地予測の順（着地は新しい予測を使うため）
    expect(mocks.recomputeForecast.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.recomputeSimulation.mock.invocationCallOrder[0]
    )
    await waitFor(() => expect(screen.getByText("¥30,000")).toBeTruthy())
  })

  it("オペレーターにはリセットボタンを出さない", async () => {
    mocks.role = "OPERATOR"
    mocks.pricingSimulation.mockResolvedValue(EMPTY)
    renderSummary()

    await waitFor(() => expect(screen.getByText("この月の着地予測はまだ生成されていません。")).toBeTruthy())
    expect(screen.queryByRole("button", { name: /AI予測値へリセット/ })).toBeNull()
  })
})
