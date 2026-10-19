import { describe, it, expect } from "vitest"

import { mockPricingCalendar } from "./demo-data"
import { demoDayType, enrichMockPricingCalendar, importMockNewHotels, getMockNewHotels, mockBookingCurveDetail, mockDailyPerformance, mockMonthPace } from "./demo-revenue"

// デモモードのデータ（2026-10）。日のタイプはバックエンド（services/forecast/dayType.test.ts）と同じ例で同じ答えになること

describe("demoDayType（バックエンドの判定と同じ考え方）", () => {
  it("バックエンドのテストと同じ入力で同じタイプになる", () => {
    expect(demoDayType(60, 50, 80, 100)).toEqual({ dayType: "B1", expectedOccupancy: 0.9, paceRatio: 1.2 })
    expect(demoDayType(40, 50, 70, 100).dayType).toBe("D5")
    expect(demoDayType(90, 40, 95, 100).dayType).toBe("A1")
    expect(demoDayType(20, null, null, 100, 0.7).dayType).toBe("C")
    expect(demoDayType(85, null, null, 100, 0.6).dayType).toBe("B")
    expect(demoDayType(10, 2, 60, 100).dayType).toBe("C")
    expect(demoDayType(null, null, null, 100).dayType).toBeNull()
  })
})

describe("enrichMockPricingCalendar", () => {
  const today = new Date()
  const calendar = enrichMockPricingCalendar(mockPricingCalendar("demo", today.getFullYear(), today.getMonth() + 1))

  it("料金カレンダーの新しい列をすべての日に埋める", () => {
    expect(calendar.totalRooms).toBe(200)
    for (const d of calendar.calendar) {
      expect(d.budgetAdr).not.toBeNull()
      expect(d.onHandRooms).toBeGreaterThanOrEqual(0)
      expect(d.onHandRooms).toBeLessThanOrEqual(200)
      expect(d.dayType).toMatch(/^[A-E][1-5]?$/)
      // 推移は今より前の残日数だけ（大きい順）
      const leads = d.dayTypeHistory.map((h) => h.daysBefore)
      expect([...leads].sort((a, b) => b - a)).toEqual(leads)
    }
    // 予算ADR は月の値（どの日も同じ）
    expect(new Set(calendar.calendar.map((d) => d.budgetAdr)).size).toBe(1)
  })
})

describe("mockBookingCurveDetail", () => {
  it("予約積上は今日の時点まで、参考カーブ・予算・PMS 連携後の系列も返す", () => {
    const stay = new Date()
    stay.setDate(stay.getDate() + 20)
    const date = `${stay.getFullYear()}-${String(stay.getMonth() + 1).padStart(2, "0")}-${String(stay.getDate()).padStart(2, "0")}`
    const curve = mockBookingCurveDetail("demo", date)
    const leads = curve.points.map((p) => p.daysBefore)
    expect(Math.min(...leads)).toBe(20)
    // 積み上がりは減らない
    const rooms = curve.points.map((p) => p.roomsBooked)
    expect(rooms).toEqual([...rooms].sort((a, b) => a - b))
    expect(curve.reference?.points.at(-1)?.daysBefore).toBe(0)
    expect(curve.budget?.adr).toBeGreaterThan(0)
    expect(curve.rateHistory?.length).toBe(curve.points.length)
    expect(curve.actual).toBeNull()
  })
})

describe("mockDailyPerformance", () => {
  it("結果の出ていない日は実績が null、予算・AI・前年はどの日にもある", () => {
    const today = new Date()
    const next = new Date(today.getFullYear(), today.getMonth() + 1, 1)
    const p = mockDailyPerformance("demo", next.getFullYear(), next.getMonth() + 1)
    expect(p.days.every((d) => d.actual === null && d.budget.revenue != null && d.ai != null && d.lastYear != null)).toBe(true)
  })
})

describe("importMockNewHotels", () => {
  it("確認では書かず、取り込むと同じ名前・同じ開業日を上書きする", () => {
    const before = getMockNewHotels("demo").length
    const first = getMockNewHotels("demo")[0]
    const dry = importMockNewHotels("demo", [{ name: first.name, openingDate: first.openingDate, rooms: 999 }, { name: "新ホテル", openingDate: "2027-04-01" }], true)
    expect(dry).toMatchObject({ dryRun: true, total: 2, created: 1, updated: 1 })
    expect(getMockNewHotels("demo")).toHaveLength(before)
    importMockNewHotels("demo", [{ name: first.name, openingDate: first.openingDate, rooms: 999 }, { name: "新ホテル", openingDate: "2027-04-01" }], false)
    expect(getMockNewHotels("demo")).toHaveLength(before + 1)
    expect(getMockNewHotels("demo").find((h) => h.name === first.name)?.rooms).toBe(999)
  })
})

describe("mockMonthPace", () => {
  it("180日前から、過ぎた月は結果まで、今月はまだ来ていない残日数を除いて返す", () => {
    const today = new Date()
    const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const done = mockMonthPace("demo", prev.getFullYear(), prev.getMonth() + 1)
    expect(done.points[0].daysBefore).toBe(180)
    expect(done.points.at(-1)?.daysBefore).toBe(0)
    const rooms = done.points.map((p) => p.rooms)
    expect(rooms).toEqual([...rooms].sort((a, b) => a - b))
    expect(done.budgetOccupancy).toBeGreaterThan(0)

    const current = mockMonthPace("demo", today.getFullYear(), today.getMonth() + 1)
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
    expect(current.points.at(-1)?.daysBefore).toBe(lastDay - today.getDate())
  })
})
