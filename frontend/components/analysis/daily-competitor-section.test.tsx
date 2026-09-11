import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"

import type { CompetitorPrices } from "@/lib/api"
import { DailyCompetitorSection } from "@/components/analysis/daily-competitor-section"

const mocks = vi.hoisted(() => ({
  competitorPrices: vi.fn(),
}))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, api: { competitorPrices: mocks.competitorPrices } }
})

// 認証コンテキスト（hotelId と週末定義の出所）は差し替える
vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ hotelId: "hotel-a", hotel: { weekendDays: [5, 6] } }),
}))

/** 2026-09-07（月）から1週間ぶんの日付 */
const DATES = [
  "2026-09-07",
  "2026-09-08",
  "2026-09-09",
  "2026-09-10",
  "2026-09-11",
  "2026-09-12",
  "2026-09-13",
]

/**
 * 課題 #57 の再現データ。
 * 自館は 1名 ¥21,225 / 2名 ¥29,715 / 3名 ¥38,205、競合は 1名 ¥24,200 で自館より高い。
 */
const RESPONSE: CompetitorPrices = {
  hotelId: "hotel-a",
  startDate: DATES[0],
  endDate: DATES[6],
  ownPrices: DATES.map((date) => ({
    date,
    price: 21_225,
    isActual: false,
    price1P: 21_225,
    price2P: 29_715,
    price3P: 38_205,
  })),
  competitors: [
    {
      id: "comp-1",
      name: "競合ホテルA",
      category: "シティ",
      prices: DATES.map((date) => ({
        date,
        price1P: 24_200,
        price2P: 31_000,
        price3P: 40_000,
        reliability: "HIGH",
      })),
    },
  ],
}

describe("DailyCompetitorSection（競合比較 — #57）", () => {
  beforeEach(() => {
    mocks.competitorPrices.mockReset()
    mocks.competitorPrices.mockResolvedValue(RESPONSE)
  })

  it("自館が安いときは価格差にマイナス記号を付ける（符号なしの ¥2,975 にしない）", async () => {
    render(<DailyCompetitorSection />)

    await waitFor(() => expect(screen.getAllByText("-¥2,975").length).toBeGreaterThan(0))
    // 符号を落とした表記が残っていないこと（色だけで方向を示さない）
    expect(screen.queryByText("¥2,975")).toBeNull()
    // 差額率と符号の向きが一致していること
    expect(screen.getAllByText("-12.3%").length).toBeGreaterThan(0)
  })

  it("＋は自館のほうが高いことを表す説明を出す（色に依存しない）", async () => {
    render(<DailyCompetitorSection />)

    await waitFor(() =>
      expect(
        screen.getAllByText(/＋は当ホテルのほうが高く、−は当ホテルのほうが安い/).length
      ).toBeGreaterThan(0)
    )
  })

  it("自館が高いときはプラス記号を付ける", async () => {
    mocks.competitorPrices.mockResolvedValue({
      ...RESPONSE,
      competitors: [
        {
          ...RESPONSE.competitors[0],
          prices: DATES.map((date) => ({
            date,
            price1P: 18_250,
            price2P: 20_000,
            price3P: 22_000,
            reliability: "HIGH",
          })),
        },
      ],
    })

    render(<DailyCompetitorSection />)

    await waitFor(() => expect(screen.getAllByText("+¥2,975").length).toBeGreaterThan(0))
    expect(screen.getAllByText("+16.3%").length).toBeGreaterThan(0)
  })

  it("自館価格が利用人数ごとに変わる（1名/2名/3名で同じ値にならない）", async () => {
    render(<DailyCompetitorSection />)

    await waitFor(() => expect(screen.getByLabelText("2名利用")).toBeInTheDocument())
    fireEvent.click(screen.getByLabelText("2名利用"))
    fireEvent.click(screen.getByLabelText("3名利用"))

    // 週平均サマリーカードは人数ごとに「自館価格 / 競合価格」を出す
    const expected: Array<[string, string]> = [
      ["1名", "¥21,225 / ¥24,200"],
      ["2名", "¥29,715 / ¥31,000"],
      ["3名", "¥38,205 / ¥40,000"],
    ]
    for (const [label, summary] of expected) {
      const heading = await screen.findByText(label)
      const card = heading.parentElement as HTMLElement
      expect(within(card).getByText(summary)).toBeInTheDocument()
    }

    // ADR 由来の単一値を全人数に使い回していないこと（#57 の回帰テスト）
    expect(screen.queryAllByText("¥21,225 / ¥31,000")).toHaveLength(0)
  })

  it("利用人数別の自館価格が無い日は「-」を出す（ADR で代用しない）", async () => {
    mocks.competitorPrices.mockResolvedValue({
      ...RESPONSE,
      ownPrices: DATES.map((date) => ({
        date,
        price: 21_225,
        isActual: true,
        price1P: null,
        price2P: null,
        price3P: null,
      })),
    })

    render(<DailyCompetitorSection />)

    await waitFor(() => expect(screen.getAllByText("¥24,200").length).toBeGreaterThan(0))
    // 自館価格が取れないので価格差も出せない
    expect(screen.queryByText("-¥2,975")).toBeNull()
    expect(screen.queryByText("¥21,225")).toBeNull()
  })
})
