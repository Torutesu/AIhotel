import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

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

function renderCard() {
  return render(<EventListCard events={EVENTS} loading={false} error={null} onReload={vi.fn()} />)
}

describe("EventListCard（ロール別の表示 — #80）", () => {
  beforeEach(() => {
    mocks.role = "OPERATOR"
  })

  it("オペレーターには編集・削除ボタンを出さず、登録ボタンは出す", () => {
    renderCard()
    expect(screen.getByText("花火大会")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "イベント「花火大会」を編集" })).toBeNull()
    expect(screen.queryByRole("button", { name: "イベント「花火大会」を削除" })).toBeNull()
    expect(screen.getByRole("button", { name: /イベントを追加/ })).toBeTruthy()
  })

  it("マネージャーには編集・削除ボタンを出す", () => {
    mocks.role = "MANAGER"
    renderCard()
    expect(screen.getByRole("button", { name: "イベント「花火大会」を編集" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "イベント「花火大会」を削除" })).toBeTruthy()
  })
})
