import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

import { EventListCard } from "@/components/pricing/event-list-card"
import type { Event as HotelEvent } from "@shared/types"

const mocks = vi.hoisted(() => ({ role: "OPERATOR" as string }))

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ hotelId: "hotel-a", user: { role: mocks.role } }),
}))

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const EVENTS = [
  {
    id: "ev-1",
    hotelId: "hotel-a",
    name: "花火大会",
    type: "festival",
    startDate: "2026-09-12T00:00:00.000Z",
    endDate: "2026-09-12T00:00:00.000Z",
    expectedImpact: "high",
  },
] as unknown as HotelEvent[]

describe("EventListCard（2026-10: 「イベントを追加」は外部需要動向へ移した）", () => {
  beforeEach(() => {
    mocks.role = "OPERATOR"
  })

  it("追加ボタンは出さず、外部需要動向へ移るボタンを出す", () => {
    const onManage = vi.fn()
    render(<EventListCard events={EVENTS} loading={false} error={null} onReload={vi.fn()} onManage={onManage} />)
    expect(screen.getByText("花火大会")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /イベントを追加/ })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /外部需要動向で登録・取り込み/ }))
    expect(onManage).toHaveBeenCalledTimes(1)
  })

  it("オペレーターには編集・削除ボタンを出さない", () => {
    render(<EventListCard events={EVENTS} loading={false} error={null} onReload={vi.fn()} />)
    expect(screen.queryByRole("button", { name: "イベント「花火大会」を編集" })).toBeNull()
    expect(screen.queryByRole("button", { name: "イベント「花火大会」を削除" })).toBeNull()
  })

  it("マネージャーにはこれまでどおり編集・削除ボタンを出す", () => {
    mocks.role = "MANAGER"
    render(<EventListCard events={EVENTS} loading={false} error={null} onReload={vi.fn()} />)
    expect(screen.getByRole("button", { name: "イベント「花火大会」を編集" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "イベント「花火大会」を削除" })).toBeTruthy()
  })
})
