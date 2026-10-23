import { describe, it, expect } from "vitest"

import { buildMonthlyBcRows, defaultStayDay } from "./booking-curve-month-card"
import { buildSampleInventory, GROUP_SEGMENTS, INVENTORY_DAYS, inventoryStartFor } from "./inventory-table-card"
import { alertPeriodLabel } from "./alerts-card"
import { splitSummaryParagraphs } from "./ai-summary-card"
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

  it("故障部屋は残室に含めず、個人 = 予約室数の合計 − 団体の予約室数（PDF a02）", () => {
    for (const d of days) {
      expect(d.totalOutOfOrder).toBe(d.types.reduce((a, t) => a + t.outOfOrder, 0))
      const booked = d.types.reduce((a, t) => a + t.capacity - t.remaining - t.outOfOrder, 0)
      expect(d.individualBooked).toBe(Math.max(0, booked - d.group.booked))
      for (const t of d.types) expect(t.remaining + t.outOfOrder).toBeLessThanOrEqual(t.capacity)
    }
    expect(days.some((d) => d.totalOutOfOrder > 0)).toBe(true)
  })

  it("表示を始める日を変えると、その日から14日になる", () => {
    const moved = buildSampleInventory(200, 1, [5, 6], new Date(2026, 10, 2))
    expect(moved[0].date).toEqual(new Date(2026, 10, 2))
    expect(moved.at(-1)?.date).toEqual(new Date(2026, 10, 15))
  })
})

// 2026-10-23 の画面修正 a01: 上部（アラート・AI解説）は当月に加えて先々も、下部は対象年月に連動
describe("inventoryStartFor", () => {
  it("対象年月が今月なら今日から、ほかの月はその月の1日から表示する", () => {
    const today = new Date(2026, 9, 23)
    expect(inventoryStartFor(2026, 10, today)).toBe("2026-10-23")
    expect(inventoryStartFor(2026, 11, today)).toBe("2026-11-01")
    expect(inventoryStartFor(2026, 9, today)).toBe("2026-09-01")
  })
})

describe("alertPeriodLabel", () => {
  it("当月・先々（翌月以降）・過去の月を見分ける。年が変われば年も付ける", () => {
    expect(alertPeriodLabel("2026-10-27T00:00:00.000Z", "2026-10-23")).toEqual({ label: "当月", future: false })
    expect(alertPeriodLabel("2026-11-01", "2026-10-23")).toEqual({ label: "11月（先々）", future: true })
    expect(alertPeriodLabel("2027-01-05", "2026-10-23")).toEqual({ label: "2027年1月（先々）", future: true })
    expect(alertPeriodLabel("2026-09-30", "2026-10-23")).toEqual({ label: "9月", future: false })
    expect(alertPeriodLabel(null, "2026-10-23")).toBeNull()
  })
})

describe("splitSummaryParagraphs", () => {
  it("行ごとの段落に分け、行頭の【当月】【先々】を見出しにする", () => {
    expect(splitSummaryParagraphs("【当月】好調です。\n\n【先々】11月は遅れています。\n補足")).toEqual([
      { heading: "当月", text: "好調です。" },
      { heading: "先々", text: "11月は遅れています。" },
      { heading: null, text: "補足" },
    ])
  })
})
