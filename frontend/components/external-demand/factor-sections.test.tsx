import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { Sun } from "lucide-react"

import { FactorCategoryCard } from "@/components/external-demand/factor-category-card"
import { UpcomingCautionsCard } from "@/components/external-demand/upcoming-cautions-card"
import { WeeklyOutlookSection } from "@/components/external-demand/weekly-outlook-section"
import { mockExternalFactors } from "@/lib/api/demo-external-signals"

// 外部需要動向の要因カード・週別の見通し・今後の注意事項（D-13 で実データに）

const FACTORS = mockExternalFactors(new Date(2026, 10, 12))

describe("FactorCategoryCard", () => {
  it("要因と出どころ・状況を出し、クリックで一覧を開く。行が無ければ案内を出す", () => {
    const onOpen = vi.fn()
    const { rerender } = render(
      <FactorCategoryCard name="アクセス" icon={Sun} factors={FACTORS.categories.access} linkLabel="一覧・CSV出力" onOpen={onOpen} />,
    )
    expect(screen.getAllByText("羽田〜台北線の増便").length).toBeGreaterThan(0)
    expect(screen.getByText("AI収集")).toBeInTheDocument()
    expect(screen.getByText("追い風")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "アクセスの一覧を開く" }))
    expect(onOpen).toHaveBeenCalled()
    rerender(<FactorCategoryCard name="アクセス" icon={Sun} factors={[]} linkLabel="一覧" onOpen={onOpen} emptyText="まだ集めた動きがありません" />)
    expect(screen.getByText("まだ集めた動きがありません")).toBeInTheDocument()
  })
})

describe("WeeklyOutlookSection", () => {
  it("8週分の予測稼働率を出し、予測が無ければ案内、失敗なら再試行を出す", () => {
    const { rerender } = render(<WeeklyOutlookSection data={FACTORS} loading={false} error={null} onRetry={() => {}} />)
    expect(screen.getByTestId("weekly-outlook")).toHaveTextContent("71%") // 1週目: 68 + 2 + 1
    rerender(<WeeklyOutlookSection data={{ ...FACTORS, weekly: FACTORS.weekly.map((w) => ({ ...w, total: null, base: null })) }} loading={false} error={null} onRetry={() => {}} />)
    expect(screen.getByText(/まだ需要予測がありません/)).toBeInTheDocument()
    const onRetry = vi.fn()
    rerender(<WeeklyOutlookSection data={null} loading={false} error="外部要因の取得に失敗しました" onRetry={onRetry} />)
    fireEvent.click(screen.getByRole("button", { name: "再試行" }))
    expect(onRetry).toHaveBeenCalled()
  })
})

describe("UpcomingCautionsCard", () => {
  const today = "2026-11-12"
  it("向かい風の要因・近く開業する新規ホテル・影響の大きいイベントを並べる", () => {
    const factors = {
      ...FACTORS,
      categories: { ...FACTORS.categories, climate: [{ ...FACTORS.categories.climate[1], name: "大雪の見通し", status: "warning" as const }] },
    }
    render(
      <UpcomingCautionsCard
        factors={factors}
        today={today}
        events={[{ id: "e1", hotelId: "h", name: "ドームツアー", type: "concert", startDate: new Date("2026-12-05"), endDate: new Date("2026-12-06"), expectedImpact: "high" }]}
        hotels={[
          { id: "n1", name: "駅前の新ホテル", openingDate: "2027-02-01T00:00:00.000Z", rooms: 200 } as never,
          { id: "n2", name: "遠い先のホテル", openingDate: "2028-01-01T00:00:00.000Z", rooms: 100 } as never,
        ]}
      />,
    )
    const card = screen.getByTestId("upcoming-cautions")
    expect(card).toHaveTextContent("大雪の見通し")
    expect(card).toHaveTextContent("1軒・計 200室")
    expect(card).not.toHaveTextContent("遠い先のホテル")
    expect(card).toHaveTextContent("ドームツアー")
  })

  it("何も無ければそう書く", () => {
    render(<UpcomingCautionsCard factors={{ ...FACTORS, categories: { climate: [], inbound: [], access: [] } }} today={today} events={[]} hotels={[]} />)
    expect(screen.getByText(/見つかっていません/)).toBeInTheDocument()
  })
})
