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
  modelApplied: true,
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
    expect(factors.textContent).toContain("この日の予報はありません")
  })

  it("D-13: 象限・似た日の着地・天気（出典つき）・日の予算の出どころ・予算への向き合い方を出す", async () => {
    mocks.dayInsight.mockReset().mockResolvedValue({
      ...INSIGHT,
      date: FUTURE,
      typeProfile: { ...INSIGHT.typeProfile!, quadrantLabel: "高稼働・高単価" },
      pattern: {
        predictedOccupancy: 0.78,
        predictedAdr: 21000,
        pickupRooms: 34.4,
        neighbors: 12,
        spread: 0.04,
        similarDates: ["2025-11-20", "2025-11-27"],
        paceCluster: {
          id: "P3",
          shape: "直前型",
          days: 40,
          finalOccupancy: 0.8,
          terms: [
            { label: "180日前以前", pickup: 0.05 },
            { label: "4〜0日前", pickup: 0.2 },
          ],
        },
        paceClusterCount: 6,
      },
      weather: {
        weatherCode: "100",
        weatherText: "晴れ",
        pop: 10,
        tempMax: 18,
        tempMin: 9,
        reliability: "A",
        reportedAt: "2026-11-12T02:00:00.000Z",
        attribution: "出典：気象庁ホームページ",
      },
    })
    render(
      <DayAnalysisDialog
        day={day(FUTURE, {
          budgetSource: "ai",
          rationale: {
            version: 1,
            modelVersion: "rule-based-v6",
            recommendedRank: 28,
            factors: [],
            adjustments: [
              { key: "pattern", impact: 0.04, input: { neighbors: 12, patternOccupancy: 0.78, pickupRooms: 34, weight: 0.7 } },
              { key: "market", impact: 0.03, input: { signals: 2 } },
            ],
            excluded: [],
            guardrails: [],
            budget: { stance: "chase", gap: 450000 },
          },
        })}
        onClose={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByTestId("day-pattern")).toBeTruthy())
    expect(screen.getByTestId("quadrant-label").textContent).toBe("高稼働・高単価")
    const pattern = within(screen.getByTestId("day-pattern"))
    expect(pattern.getByText("78.0%")).toBeTruthy()
    expect(pattern.getByText("34室")).toBeTruthy()
    expect(pattern.getByText("直前型")).toBeTruthy()
    expect(pattern.getByText("4〜0日前")).toBeTruthy()
    expect(pattern.getByText(/2025\/11\/20/)).toBeTruthy()
    const factors = screen.getByTestId("external-factors")
    expect(factors.textContent).toContain("晴れ・降水確率 10%・気温 最高 18℃／最低 9℃・信頼度 A")
    expect(factors.textContent).toContain("出典：気象庁ホームページ")
    expect(screen.getByTestId("day-budget").textContent).toContain("AIの予測で配分")
    expect(screen.getByTestId("budget-stance").textContent).toContain("予算を追う（稼働寄り）")
    expect(screen.getByTestId("budget-stance").textContent).toContain("¥450,000")
    expect(screen.getByText(/似た日の着地：背景と入り方の近い過去の12日の着地は稼働78.0%/)).toBeTruthy()
    expect(screen.getByText(/市場の動き（インバウンド・アクセスなど） \+3pt/)).toBeTruthy()
    expect(screen.getByText(/集めた2件の動きを稼働率予測に反映/)).toBeTruthy()
  })

  it("見出し（日付・日のタイプ）はスクロールの範囲の外にあり、本文だけがスクロールする（2026-10-23 の画面修正 b03）", async () => {
    render(<DayAnalysisDialog day={day(FUTURE)} onClose={vi.fn()} />)
    const header = screen.getByTestId("day-analysis-header")
    const body = screen.getByTestId("day-analysis-body")
    expect(header.contains(screen.getByTestId("day-type-header"))).toBe(true)
    expect(body.contains(header)).toBe(false)
    expect(body.className).toContain("overflow-y-auto")
    await waitFor(() => expect(body.contains(screen.getAllByTestId("similar-day")[0])).toBe(true))
    const content = body.parentElement as HTMLElement
    expect(content.className).toContain("overflow-hidden")
    expect(content.className).not.toContain("overflow-y-auto")
  })

  it("価格戦略で日のタイプによる寄せを切っていれば、AI が優先モデルを使っているとは書かない", async () => {
    mocks.dayInsight.mockReset().mockResolvedValue({ ...INSIGHT, date: FUTURE, modelApplied: false })
    render(<DayAnalysisDialog day={day(FUTURE)} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/この型の優先モデル/)).toBeTruthy())
    expect(screen.queryByText(/AI が割り当てた優先モデル/)).toBeNull()
    expect(screen.queryByText(/AI は「バランス」で推奨価格を決めています/)).toBeNull()
    expect(screen.getAllByText(/「寄せない」にしているため/).length).toBeGreaterThan(0)
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
