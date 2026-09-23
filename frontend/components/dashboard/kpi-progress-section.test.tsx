import { describe, it, expect, vi, beforeEach } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"

import { useMultiMonthKpis } from "@/components/dashboard/kpi-progress-section"

const mocks = vi.hoisted(() => ({ dashboardKpi: vi.fn() }))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, api: { dashboardKpi: mocks.dashboardKpi } }
})

describe("useMultiMonthKpis（複数月表示の失敗 — #80）", () => {
  beforeEach(() => {
    mocks.dashboardKpi.mockReset()
  })

  it("取得に失敗したら黙って空にせずエラーを返し、retry で取り直せる", async () => {
    mocks.dashboardKpi.mockRejectedValue(new Error("network"))
    const { result } = renderHook(() => useMultiMonthKpis("hotel-a", 2026, 11, 3))

    await waitFor(() => expect(result.current.error).toBe("複数月のKPIの取得に失敗しました"))
    expect(result.current.kpis).toEqual([])
    // 11月から3か月 = 11月・12月・翌年1月
    expect(mocks.dashboardKpi.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      [2026, 11],
      [2026, 12],
      [2027, 1],
    ])

    mocks.dashboardKpi.mockResolvedValue({ year: 2026, month: 11 })
    act(() => result.current.retry())

    await waitFor(() => expect(result.current.kpis).toHaveLength(3))
    expect(result.current.error).toBeNull()
  })

  it("1か月表示では取得しない", () => {
    const { result } = renderHook(() => useMultiMonthKpis("hotel-a", 2026, 9, 1))
    expect(mocks.dashboardKpi).not.toHaveBeenCalled()
    expect(result.current.error).toBeNull()
  })
})
