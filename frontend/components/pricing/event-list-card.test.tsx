import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

import { EventListCard } from "@/components/pricing/event-list-card"
import type { Event as HotelEvent } from "@shared/types"

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

describe("EventListCard（2026-10: 登録は外部需要動向へ移した）", () => {
  it("一覧だけを出し、追加・編集・削除のボタンは出さない", () => {
    render(<EventListCard events={EVENTS} loading={false} error={null} onReload={vi.fn()} />)
    expect(screen.getByText("花火大会")).toBeTruthy()
    expect(screen.getByText("影響度:高")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /イベントを追加/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /を編集/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /を削除/ })).toBeNull()
  })

  it("「外部需要動向で登録・取り込み」から移動できる", () => {
    const onManage = vi.fn()
    render(<EventListCard events={[]} loading={false} error={null} onReload={vi.fn()} onManage={onManage} />)
    expect(screen.getByText("この期間のイベント情報は登録されていません。")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /外部需要動向で登録・取り込み/ }))
    expect(onManage).toHaveBeenCalledTimes(1)
  })
})
