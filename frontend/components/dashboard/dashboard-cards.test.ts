import { describe, it, expect } from "vitest"

import { buildMonthlyBcRows, defaultStayDay } from "./booking-curve-month-card"
import { buildSampleInventory, GROUP_SEGMENTS, INVENTORY_DAYS } from "./inventory-table-card"
import type { BookingCurve } from "@/lib/api"

// ダッシュボードの月間ブッキングカーブ（DB01）と在庫表（DB02 — 2026-10）

describe("buildMonthlyBcRows", () => {
  const curve: BookingCurve = {
    hotelId: "h",
    stayDate: "2026-10-10",
    totalRooms: 100,
    points: [
      { daysBefore: 5, roomsBooked: 40, occupancy: 0.4 },
      { daysBefore: 3, roomsBooked: 55, occupancy: 0.55 },
    ],
    reference: { date: "2025-10-11", points: [{ daysBefore: 6, roomsBooked: 30, occupancy: 0.3 }, { daysBefore: 0, roomsBooked: 70, occupancy: 0.7 }], finalRooms: 70, finalOccupancy: 0.7, adr: 10000 },
    rateHistory: [{ daysBefore: 5, price: 12000 }],
  }

  it("一番古い記録から宿泊日まで、予約日ごとの行を作る", () => {
    const rows = buildMonthlyBcRows(curve)
    expect(rows.map((r) => r.daysBefore)).toEqual([6, 5, 4, 3, 2, 1, 0])
    expect(rows[0]).toMatchObject({ label: "10/4", rooms: null, reference: 30 })
    expect(rows[1]).toMatchObject({ label: "10/5", rooms: 40, rate: 12000 })
    expect(rows.at(-1)).toMatchObject({ label: "10/10", rooms: null, reference: 70, group: null, adr: null })
  })

  it("既定の宿泊日は、今月なら今日、ほかの月は15日", () => {
    expect(defaultStayDay(2026, 10, new Date(2026, 9, 19))).toBe(19)
    expect(defaultStayDay(2026, 11, new Date(2026, 9, 19))).toBe(15)
  })
})

describe("buildSampleInventory", () => {
  const days = buildSampleInventory(200, 1, [5, 6], new Date(2026, 9, 19))

  it("14日分・部屋タイプは客室数の比（SD1 120 / DX1 60 / DX2 20）", () => {
    expect(days).toHaveLength(INVENTORY_DAYS)
    expect(days[0].types.map((t) => t.capacity)).toEqual([120, 60, 20])
  })

  it("合計・団体の合計・販売可能室数のつじつまが合う", () => {
    for (const d of days) {
      expect(d.totalRemaining).toBe(d.types.reduce((a, t) => a + t.remaining, 0))
      expect(d.group.booked).toBe(GROUP_SEGMENTS.reduce((a, s) => a + d.segments[s.key].booked, 0))
      expect(d.group.expected).toBe(d.group.booked - d.group.wash)
      expect(d.sellable).toBe(d.totalRemaining + d.group.wash)
      for (const t of d.types) expect(t.remaining).toBeLessThanOrEqual(t.capacity)
    }
  })
})
