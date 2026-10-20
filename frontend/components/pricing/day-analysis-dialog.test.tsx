import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"

import { DayAnalysisDialog } from "./day-analysis-dialog"
import type { DayInsight, DaySimulation, PricingCalendarDay } from "@/lib/api"

// 日のAI分析（2026-10 の画面修正 PDF b01・b03、xlsx DP03）: 日のタイプと優先モデル、同じタイプの日、
// この日の外部要因（イベント・天候）、日単位のシミュレーション

const mocks = vi.hoisted(() => ({ dayInsight: vi.fn(), daySimulation: vi.fn(), bookingCurve: vi.fn(), priceRanks: vi.fn() }))

vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ hotelId: "hotel-a" }) }))
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, api: { ...actual.api, ...mocks } }
})

const future = new Date()
future.setDate(future.getDate() + 30)
const FUTURE = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}-${String(future.getDate()).padStart(2, "0")}`

function day(date: string, overrides: Partial<PricingCalendarDay> = {}): PricingCalendarDay {
  return {
    date,
    demandLevel: "C",
    recommendedRank: 28,
    recommendedPrice: 22769,
    rankLabel: "R28",
    price1P: 22769,
    price2P: null,
    price3P: null,
    predictedOccupancy: 0.71,
    predictedAdr: 22000,
    actualOccupancy: null,
    actualAdr: null,
    competitorMedianPrice: 14880,
    competitorMinPrice: null,
    competitorMaxPrice: null,
    confidence: 0.8,
    budgetRooms: 140,
    budgetOccupancy: 0.7,
    budgetAdr: 18500,
    budgetRevenue: 2590000,
    onHandRooms: 62,
    currentOccupancy: 0.31,
    onHandAdr: null,
    currentRevenue: null,
    expectedRevenue: 3100000,
    dayType: "平日A型",
    dayTypeModel: "balanced",
    dayTypeTypicalOccupancy: 0.82,
    dayTypeHistory: [
      { daysBefore: 90, dayType: "平日B型", otbRooms: 12 },
      { daysBefore: 60, dayType: "平日A型", otbRooms: 30 },
    ],
    ...overrides,
  }
}

const INSIGHT: DayInsight = {
  date: FUTURE,
  category: "平日",
  dayType: { name: "平日A型", model: "balanced", typicalOccupancy: 0.82 },
  history: [
    { daysBefore: 90, dayType: "平日B型", otbRooms: 12 },
    { daysBefore: 60, dayType: "平日A型", otbRooms: 30 },
  ],
  typeProfile: {
    name: "平日A型",
    model: "balanced",
    days: 42,
    avgOccupancy: 0.82,
    minOccupancy: 0.76,
    maxOccupancy: 0.9,
    avgAdr: 18400,
    referenceCurve: [
      { daysBefore: 90, roomsBooked: 30 },
      { daysBefore: 0, roomsBooked: 164 },
    ],
  },
  categoryTypes: [
    { name: "平日A型", model: "balanced", days: 42, avgOccupancy: 0.82, avgAdr: 18400 },
    { name: "平日B型", model: "occupancy", days: 80, avgOccupancy: 0.62, avgAdr: 15200 },
  ],
  similarDays: ["2026-11-02", "2026-11-04", "2026-11-09", "2026-11-11", "2026-11-16"].map((d, i) => ({
    date: d,
    dayType: "平日A型",
    isActual: i < 2,
    occupancy: 0.8,
    adr: 18000,
    recommendedPrice: i < 2 ? null : 19000,
  })),
  events: [{ name: "港まつり", type: "festival", location: "港湾", expectedImpact: "high", excludeFromHistory: false }],
  weather: null,
}

const SIMULATION: DaySimulation = {
  date: FUTURE,
  totalRooms: 200,
  otbRooms: 62,
  elasticity: 1,
  aiModel: "balanced",
  dayType: "平日A型",
  base: { rank: 28, price: 22769, adr: 22000, occupancy: 0.71, rooms: 142, revenue: 3124000, revPar: 15620 },
  options: [
    { model: "occupancy", rank: 26, price: 21000, adr: 20300, weights: { occupancy: 60, adr: 20, competitor: 20 }, isCurrent: false, occupancy: 0.77, rooms: 154, revenue: 3126200, revPar: 15631 },
    { model: "balanced", rank: 28, price: 22769, adr: 22000, weights: { occupancy: 40, adr: 40, competitor: 20 }, isCurrent: true, occupancy: 0.71, rooms: 142, revenue: 3124000, revPar: 15620 },
    { model: "adr", rank: 30, price: 24500, adr: 23700, weights: { occupancy: 20, adr: 60, competitor: 20 }, isCurrent: false, occupancy: 0.66, rooms: 132, revenue: 3128400, revPar: 15642 },
  ],
  manual: null,
}

describe("DayAnalysisDialog", () => {
  beforeEach(() => {
    mocks.dayInsight.mockReset().mockResolvedValue({ ...INSIGHT, date: FUTURE })
    mocks.daySimulation.mockReset().mockResolvedValue(SIMULATION)
    mocks.bookingCurve.mockReset().mockResolvedValue({ hotelId: "hotel-a", stayDate: FUTURE, totalRooms: 200, points: [{ daysBefore: 30, roomsBooked: 62, occupancy: 0.31 }] })
    mocks.priceRanks.mockReset().mockResolvedValue([{ id: "r", rank: 28, label: "R28", price1P: 22769 }])
  })

  it("見出しの横に今の日のタイプ・優先モデルと90日前のタイプ、本文に型の一覧・同じタイプの日5日・外部要因を出す", async () => {
    render(<DayAnalysisDialog day={day(FUTURE)} onClose={vi.fn()} />)
    expect(screen.getByTestId("day-type-header").textContent).toBe("日のタイプ平日A型バランス90日前平日B型")
    expect(mocks.dayInsight).toHaveBeenCalledWith("hotel-a", FUTURE)

    await waitFor(() => expect(screen.getAllByTestId("similar-day")).toHaveLength(5))
    expect(screen.getByText("AI が作った平日の型（過去の結果から。型の数はデータで決まります）")).toBeTruthy()
    // 推移で型が上がった見立て
    expect(screen.getByText("予約が想定より強く入り、型が上がりました")).toBeTruthy()
    // この日の外部要因（イベント・天候を項目別に）
    const factors = screen.getByTestId("external-factors")
    expect(factors.textContent).toContain("港まつり・港湾・影響度 高")
    expect(factors.textContent).toContain("天候データは未連携です")
  })

  it("先の日は日単位のシミュレーション（AI の推奨と優先モデル3つ）を出す", async () => {
    render(<DayAnalysisDialog day={day(FUTURE)} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText("この日のシミュレーション")).toBeTruthy())
    expect(mocks.daySimulation).toHaveBeenCalledWith("hotel-a", FUTURE, undefined)
    await waitFor(() => expect(screen.getByText("AI の推奨（バランス）")).toBeTruthy())
    const card = within(screen.getByTestId("day-simulation"))
    expect(card.getByText("稼働優先")).toBeTruthy()
    expect(card.getByText("単価優先")).toBeTruthy()
    expect(card.getByText("← AI が今使っているモデル")).toBeTruthy()
    expect(card.getByText(/価格弾力性 1.0/)).toBeTruthy()
  })

  it("結果の出た日はシミュレーションを出さない", async () => {
    render(<DayAnalysisDialog day={day("2025-01-15", { actualAdr: 18000, actualOccupancy: 0.8 })} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText("結果の出た日のため、シミュレーションはありません。")).toBeTruthy())
    expect(mocks.daySimulation).not.toHaveBeenCalled()
  })

  it("日の分析の取得に失敗したらその旨と再試行を出し、再試行で取り直す", async () => {
    mocks.dayInsight.mockReset().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ ...INSIGHT, date: FUTURE })
    render(<DayAnalysisDialog day={day(FUTURE)} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText("日の分析の取得に失敗しました")).toBeTruthy())
    fireEvent.click(screen.getAllByRole("button", { name: "再試行" })[0])
    await waitFor(() => expect(screen.getAllByTestId("similar-day")).toHaveLength(5))
  })
})
