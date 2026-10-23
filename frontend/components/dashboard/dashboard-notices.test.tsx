import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

import { AlertsCard } from "./alerts-card"
import { AiSummaryCard } from "./ai-summary-card"
import type { AlertItem } from "@/lib/api"

// ダッシュボード上部（2026-10-23 の画面修正 a01）: アラートは対象の月（当月・先々）を添え、
// 先々のアラートはその月の画面へ。AI解説は【当月】【先々】を見出しとして出す

vi.mock("@/components/alert-actions", () => ({ AlertActions: () => null }))

function alert(overrides: Partial<AlertItem>): AlertItem {
  return {
    id: "a",
    severity: "YELLOW",
    level: 4,
    title: "t",
    message: "m",
    linkTab: "pricing",
    targetDate: null,
    status: "OPEN",
    detectedAt: "2026-10-23T00:00:00.000Z",
    ...overrides,
  }
}

describe("AlertsCard", () => {
  it("先々のアラートは対象の月を添え、リンクはその月・その日で開く。月単位のアラートは年月だけ見せる", () => {
    const now = new Date()
    const y = now.getFullYear() + 1 // 来年の日付なら、いつ実行しても「先々」になる
    const onAlertNavigate = vi.fn()
    render(
      <AlertsCard
        loading={false}
        onAlertNavigate={onAlertNavigate}
        alerts={[
          alert({ id: "day", title: "日のアラート", targetDate: `${y}-12-02T00:00:00.000Z` }),
          alert({ id: "month", title: "月のアラート", targetDate: `${y}-11-01T00:00:00.000Z`, ruleKey: `LANDING_BELOW_BUDGET:${y}-11` }),
        ]}
      />,
    )
    expect(screen.getByText(`${y}年12月（先々）`)).toBeTruthy()
    expect(screen.getByText(`${y}年11月（先々）`)).toBeTruthy()
    const dayLink = screen.getByRole("button", { name: `${y}/12/02 (料金設定へ)` })
    const monthLink = screen.getByRole("button", { name: `${y}年11月 (料金設定へ)` })

    fireEvent.click(dayLink)
    expect(onAlertNavigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ tab: "pricing", periodMonth: `${y}-12`, focusDate: `${y}-12-02` }),
    )
    fireEvent.click(monthLink)
    expect(onAlertNavigate).toHaveBeenLastCalledWith({ tab: "pricing", label: "料金設定へ", periodMonth: `${y}-11` })
  })
})

describe("AiSummaryCard", () => {
  it("行頭の【当月】【先々】を、括弧を残したまま見出しとして段落ごとに出す", () => {
    render(
      <AiSummaryCard
        loading={false}
        summary={{ id: "s", section: "dashboard-summary", content: "【当月】好調です。\n【先々】11月は遅れています。", generatedAt: "2026-10-23T00:00:00.000Z" }}
      />,
    )
    const paragraphs = screen.getAllByText(/好調です。|11月は遅れています。/)
    expect(paragraphs.map((p) => p.textContent)).toEqual(["【当月】好調です。", "【先々】11月は遅れています。"])
  })
})
