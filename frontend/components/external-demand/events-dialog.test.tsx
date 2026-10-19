import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"

import { EventsDialog, upcomingEvents } from "@/components/external-demand/events-dialog"
import type { Event as HotelEvent } from "@shared/types"

// 外部需要動向 > イベントの一覧（2026-10。登録はオペレーターも可、編集・削除・取り込みは MANAGER 以上）

const mocks = vi.hoisted(() => ({ role: "OPERATOR" as string }))

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ hotelId: "hotel-a", user: { role: mocks.role } }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const EVENTS = [
  { id: "past", hotelId: "hotel-a", name: "春の祭り", type: "festival", startDate: "2020-04-01T00:00:00.000Z", endDate: "2020-04-02T00:00:00.000Z" },
  { id: "next", hotelId: "hotel-a", name: "国際医学会", type: "conference", startDate: "2099-11-15T00:00:00.000Z", endDate: "2099-11-17T00:00:00.000Z", expectedImpact: "high", location: "国際会議場" },
] as unknown as HotelEvent[]

function renderDialog(events: HotelEvent[] = EVENTS) {
  return render(<EventsDialog open onOpenChange={vi.fn()} events={events} loading={false} error={null} onReload={vi.fn()} />)
}

describe("upcomingEvents", () => {
  it("今日以降に終わるイベントだけを残す", () => {
    expect(upcomingEvents(EVENTS, "2026-10-19").map((e) => e.id)).toEqual(["next"])
  })
})

describe("EventsDialog", () => {
  beforeEach(() => {
    mocks.role = "OPERATOR"
  })

  it("既定は今後のイベントだけ。「すべて」で過去も出る", () => {
    renderDialog()
    const table = screen.getByRole("table")
    expect(within(table).getByText("国際医学会")).toBeTruthy()
    expect(within(table).queryByText("春の祭り")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "すべて" }))
    expect(within(screen.getByRole("table")).getByText("春の祭り")).toBeTruthy()
  })

  it("オペレーターは登録と CSV 出力はできるが、編集・削除・取り込みはできない", () => {
    renderDialog()
    expect(screen.getByRole("button", { name: /イベントを追加/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /CSV出力/ })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "イベント「国際医学会」を編集" })).toBeNull()
    expect(screen.queryByRole("button", { name: /CSV を選択/ })).toBeNull()
    expect(screen.getByText(/取り込みはマネージャー以上/)).toBeTruthy()
  })

  it("マネージャーは編集・削除・取り込みができる", () => {
    mocks.role = "MANAGER"
    renderDialog()
    expect(screen.getByRole("button", { name: "イベント「国際医学会」を編集" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "イベント「国際医学会」を削除" })).toBeTruthy()
    expect(screen.getByRole("button", { name: /テンプレートをダウンロード/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /CSV を選択/ })).toBeTruthy()
  })

  it("イベントが無ければ案内を出し、CSV 出力は押せない", () => {
    renderDialog([])
    expect(screen.getByText("今後のイベントは登録されていません。")).toBeTruthy()
    expect((screen.getByRole("button", { name: /CSV出力/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})
