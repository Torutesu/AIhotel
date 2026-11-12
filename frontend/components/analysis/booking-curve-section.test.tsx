import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

import { BookingCurveSection, curveSegmentOptions } from "./booking-curve-section"
import type { BookingCurve } from "@/lib/api"

// 分析タブのブッキングカーブ（D-13 — 作り値の系列をやめ、無い系列は描かない）

const bookingCurve = vi.fn()
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ hotelId: "h1" }) }))
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: { bookingCurve: (...a: unknown[]) => bookingCurve(...a) },
}))

const base: BookingCurve = {
  hotelId: "h1",
  stayDate: "2026-11-20",
  totalRooms: 100,
  points: [
    { daysBefore: 30, roomsBooked: 40, occupancy: 0.4 },
    { daysBefore: 10, roomsBooked: 60, occupancy: 0.6 },
  ],
  reference: { date: "2025-11-21", points: [], finalRooms: null, finalOccupancy: null, adr: null },
  budget: { rooms: 85, occupancy: 0.85, adr: null },
  prediction: null,
  actual: null,
}

describe("BookingCurveSection", () => {
  beforeEach(() => {
    bookingCurve.mockReset()
  })

  it("予約明細が無ければ区分は全体だけで、ADR の取り込みを案内し、サンプルの注記は出さない", async () => {
    bookingCurve.mockResolvedValue(base)
    render(<BookingCurveSection stayDate={new Date(2026, 10, 20)} />)
    expect(await screen.findByText(/室料・人数の入った予約明細を取り込むと表示します/)).toBeTruthy()
    expect(bookingCurve).toHaveBeenCalledWith("h1", "2026-11-20")
    expect(screen.queryByText(/サンプル/)).toBeNull()
  })

})

describe("curveSegmentOptions", () => {
  it("内訳のある区分だけを選べる（部屋タイプが無ければ出さない）", () => {
    const curve = { ...base, breakdowns: { roomType: [], guests: [{ label: "2名利用", points: [] }] } }
    expect(curveSegmentOptions("daily", curve, null)).toEqual({ options: { total: [], roomType: [], guests: ["2名利用"] }, types: ["total", "guests"] })
    expect(curveSegmentOptions("daily", base, null).types).toEqual(["total"])
  })

  it("月単位は予約明細のある月だけ利用人数別を選べる", () => {
    const month = { year: 2026, month: 11, totalRooms: 100, budgetRooms: null, segmentNames: ["1名", "2名"], reservations: 3, points: [] }
    expect(curveSegmentOptions("monthly", null, month).types).toEqual(["total", "guests"])
    expect(curveSegmentOptions("monthly", null, { ...month, reservations: 0 }).types).toEqual(["total"])
  })
})
