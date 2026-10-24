import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"

import { ALL_ROOM_TYPES, PriceCalendarSection, summarizeCalendar, type RoomTypeSwitch } from "./price-calendar-section"
import { toOnHandRows } from "./on-hand-chart"
import { saleOpenStatus } from "./pricing-constants"
import type { PricingCalendarDay } from "@/lib/api"

// 日別価格カレンダー（2026-10 の画面修正 DP02 / DP04）

vi.mock("@/hooks/use-weekend", () => ({ useWeekend: () => ({ isWeekendDow: (d: number) => d === 5 || d === 6, weekendDays: [5, 6] }) }))

function day(date: string, overrides: Partial<PricingCalendarDay> = {}): PricingCalendarDay {
  return {
    date,
    demandLevel: "C",
    recommendedRank: 28,
    recommendedPrice: 16150,
    rankLabel: "R28",
    price1P: 16150,
    price2P: null,
    price3P: null,
    predictedOccupancy: 0.71,
    predictedAdr: 16150,
    actualOccupancy: null,
    actualAdr: null,
    competitorMedianPrice: null,
    competitorMinPrice: null,
    competitorMaxPrice: null,
    confidence: null,
    budgetRooms: 72,
    budgetOccupancy: 0.72,
    budgetAdr: 16383,
    budgetRevenue: 72 * 16383,
    onHandRooms: 31,
    currentOccupancy: 0.31,
    onHandAdr: null,
    currentRevenue: null,
    expectedRevenue: 71 * 16150,
    dayType: "平日A型",
    dayTypeModel: "balanced",
    dayTypeTypicalOccupancy: 0.82,
    dayTypeHistory: [],
    ...overrides,
  }
}

const DAYS = [
  day("2026-12-01"),
  day("2026-12-02", { dayType: "平日C型", dayTypeModel: "occupancy", onHandRooms: 28, currentOccupancy: 0.28 }),
  day("2026-12-03", { actualAdr: 16453, actualOccupancy: 0.696, onHandAdr: 16453, onHandRooms: 70, currentOccupancy: 0.7, currentRevenue: 70 * 16453 }),
]

describe("summarizeCalendar", () => {
  it("予算・現在・AI の月計を出す（現在ADR は売上の分かる日だけ）", () => {
    const s = summarizeCalendar(DAYS, 100)
    expect(s.budgetRevenue).toBe(3 * 72 * 16383)
    expect(s.budgetAdr).toBeCloseTo(16383)
    expect(s.budgetOccupancy).toBeCloseTo(0.72)
    expect(s.currentOccupancy).toBeCloseTo((31 + 28 + 70) / 300)
    expect(s.currentRevenue).toBe(70 * 16453)
    expect(s.currentAdr).toBeCloseTo(16453)
    expect(s.predictedOccupancy).toBeCloseTo(0.71)
    expect(s.expectedAdr).toBeCloseTo(16150)
  })

  it("値の欠けた日は稼働率・ADR の分母に入れない（予約の記録・予測の無い日を 0室と数えない）", () => {
    const s = summarizeCalendar(
      [
        day("2026-12-01", { onHandRooms: 40, predictedOccupancy: 0.8, expectedRevenue: 80 * 15000 }),
        day("2026-12-02", { onHandRooms: null, predictedOccupancy: null, expectedRevenue: null }),
        day("2026-12-03", { onHandRooms: 60, predictedOccupancy: 0.6, expectedRevenue: null }),
      ],
      100,
    )
    expect(s.currentOccupancy).toBeCloseTo(0.5)
    expect(s.predictedOccupancy).toBeCloseTo(0.7)
    // 想定ADR は想定売上の分かる日（1日目）だけで出す
    expect(s.expectedAdr).toBeCloseTo(15000)
    expect(s.expectedRevenue).toBe(80 * 15000)
  })

  it("予算が未登録なら予算の月計は出さない", () => {
    const s = summarizeCalendar(
      DAYS.map((d) => ({ ...d, budgetRooms: null, budgetOccupancy: null, budgetAdr: null, budgetRevenue: null })),
      100,
    )
    expect(s.budgetAdr).toBeNull()
    expect(s.budgetOccupancy).toBeNull()
    expect(s.budgetRevenue).toBeNull()
  })
})

describe("toOnHandRows", () => {
  it("日・曜日とオンハンド・予算の値を並べる", () => {
    const rows = toOnHandRows(DAYS)
    expect(rows[0]).toMatchObject({ day: 1, dow: 2, label: "1（火）", onHandRooms: 31, budgetRooms: 72, budgetAdr: 16383 })
    expect(rows[2].onHandAdr).toBe(16453)
  })
})

describe("PriceCalendarSection", () => {
  it("DP02 の列（日のタイプ・予算・現在・想定）を並べ、結果・差異の列は出さない", () => {
    render(
      <PriceCalendarSection
        monthData={{ year: 2026, month: 12, calendar: DAYS }}
        totalRooms={100}
        highlightedDate={null}
        onSelectRowForAnalysis={vi.fn()}
      />,
    )
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim())
    for (const label of ["日付", "曜日", "日のタイプ", "アラート", "予算ADR", "現在ADR", "推奨ADR", "予算稼働率", "現在稼働率", "稼働率予測（AI）", "推奨料金ランク", "予算売上", "現在売上", "想定売上"]) {
      expect(headers.some((h) => h?.startsWith(label)), label).toBe(true)
    }
    expect(headers.some((h) => h?.includes("ADR結果") || h?.includes("差異"))).toBe(false)
    expect(screen.getAllByLabelText(/日のタイプ 平日A型（平日の中で需要がいちばん強い型（平均稼働 82.0%）・バランス）/)).toHaveLength(2)
    expect(screen.getByLabelText(/日のタイプ 平日C型/)).toBeTruthy()
    expect(screen.getByText("月計")).toBeTruthy()
    // 見出しは「オンハンド状況」のみ（2026-10-23 の画面修正 b04: 「個人団体別」を外す）
    expect(screen.getByText("オンハンド状況")).toBeTruthy()
    expect(screen.queryByText(/個人団体別/)).toBeNull()
    expect(screen.queryByText("価格推移グラフ")).toBeNull()
  })

  // 2026-10-24 の画面修正: タイプ別人数別カレンダーを外し、現在・推奨料金ランクの上でタイプ（ALL ＋ 各部屋タイプ）を切り替える
  const OPTIONS = [
    { id: "rt-1", name: "スタンダードシングル" },
    { id: "rt-2", name: "モデレートツイン" },
  ]
  const TYPE_DAYS = DAYS.map((d) => ({
    ...d,
    budgetRooms: null,
    budgetOccupancy: null,
    budgetAdr: null,
    budgetRevenue: null,
    onHandRooms: d.actualAdr != null ? 20 : null,
    currentOccupancy: d.actualAdr != null ? 0.4 : null,
    predictedOccupancy: 0.6,
    predictedAdr: 18000,
    expectedRevenue: 30 * 18000,
  }))
  const renderWith = (sw: Partial<RoomTypeSwitch>) =>
    render(
      <PriceCalendarSection
        monthData={{ year: 2026, month: 12, calendar: DAYS }}
        totalRooms={100}
        highlightedDate={null}
        onSelectRowForAnalysis={vi.fn()}
        roomTypeSwitch={{ options: OPTIONS, value: ALL_ROOM_TYPES, onChange: vi.fn(), data: null, loading: false, error: null, onRetry: vi.fn(), ...sw }}
      />,
    )

  it("表示の切り替え（テーブル表示／タイプ別人数別カレンダー）は無く、タイプの切り替えは 現在・推奨料金ランク の真上にあり、既定は ALL", () => {
    renderWith({})
    expect(screen.queryByText("タイプ別人数別カレンダー")).toBeNull()
    expect(screen.queryByRole("button", { name: /テーブル表示/ })).toBeNull()

    const trigger = screen.getByTestId("calendar-room-type")
    expect(trigger.textContent).toBe("ALL")
    // 見出しの1行目: 日付〜稼働率予測（AI）の10列の上は空け、料金ランクの2列の上にタイプの切り替え
    const headRows = screen.getAllByRole("row").filter((r) => r.closest("thead"))
    const [switchRow, labelRow] = headRows
    const cells = Array.from(switchRow.children) as HTMLTableCellElement[]
    expect(cells.map((c) => c.colSpan)).toEqual([10, 2, 3])
    expect(cells[1].contains(trigger)).toBe(true)
    const labels = Array.from(labelRow.children).map((c) => c.textContent?.trim() ?? "")
    expect(labels[10]).toMatch(/^現在料金ランク/)
    expect(labels[11]).toMatch(/^推奨料金ランク/)
    expect(screen.getByText(/数値は全タイプの合計（ALL）/)).toBeTruthy()
  })

  it("タイプを選ぶとそのタイプの数値を表に出し、予算は「-」。オンハンド状況のグラフは ALL のまま", () => {
    renderWith({ value: "rt-2", data: { year: 2026, month: 12, totalRooms: 50, calendar: TYPE_DAYS } })
    expect(screen.getByTestId("calendar-room-type").textContent).toBe("モデレートツイン")
    expect(screen.getByText("日別価格カレンダー（2026年12月・モデレートツイン）")).toBeTruthy()
    expect(screen.getByText(/数値は「モデレートツイン」（50室）の値です。予算はタイプ別には持たないため「-」/)).toBeTruthy()

    const firstRow = screen.getByRole("button", { name: "12月1日のAI分析を開く" })
    const cells = within(firstRow).getAllByRole("cell").map((c) => c.textContent)
    // 予算ADR・予算稼働率・予算売上は「-」、推奨ADR・稼働率予測はタイプの値
    expect(cells[4]).toBe("-")
    expect(cells[7]).toBe("-")
    expect(cells[12]).toBe("-")
    expect(cells[6]).toBe("¥18,000")
    expect(cells[9]).toBe("60.0%")
    // 月計の稼働率はタイプの室数（50室）に対して: 結果の出た日 20室 ÷ 50室
    expect(screen.getByText(/稼働率は月のタイプの室数に対して/)).toBeTruthy()
    // 先の日のタイプ別の予約は PMS 連携後
    expect(screen.getByText(/タイプ別の先の日の予約（現在稼働率・現在ADR・現在売上）は、PMS／サイトコントローラー連携後に表示します/)).toBeTruthy()
    expect(screen.getByText("オンハンド状況")).toBeTruthy()
  })

  it("タイプの数値の取得中は表を読み込み中に、失敗したらエラーと再試行を出す（タイプの切り替えは残す）", () => {
    const { unmount } = renderWith({ value: "rt-1", loading: true })
    expect(screen.queryByRole("button", { name: "12月1日のAI分析を開く" })).toBeNull()
    expect(screen.getByTestId("calendar-room-type")).toBeTruthy()
    unmount()

    const onRetry = vi.fn()
    renderWith({ value: "rt-1", error: "タイプ別の数値の取得に失敗しました", onRetry })
    expect(screen.getByText("タイプ別の数値の取得に失敗しました")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "再試行" }))
    expect(onRetry).toHaveBeenCalled()
    expect(screen.queryByText("月計")).toBeNull()
  })
})

describe("saleOpenStatus（販売開始は宿泊日の N日前 — 2026-10 PDF b04）", () => {
  it("月の1日・末日の販売開始日から、販売開始前・一部販売中・全日販売中を決める", () => {
    const today = new Date(2026, 9, 20) // 2026-10-20
    // 2027年9月: 1日の330日前 = 2026-10-06、30日の330日前 = 2026-11-04 → 一部販売中（今日 + 330日 = 2027-09-15 まで）
    const partial = saleOpenStatus(2027, 9, 330, today)
    expect(partial?.state).toBe("partial")
    expect(partial?.openedThrough).toEqual(new Date(2027, 8, 15))
    expect(saleOpenStatus(2027, 12, 330, today)?.state).toBe("before")
    expect(saleOpenStatus(2026, 11, 330, today)?.state).toBe("open")
    expect(saleOpenStatus(2027, 9, null, today)).toBeNull()
  })
})
