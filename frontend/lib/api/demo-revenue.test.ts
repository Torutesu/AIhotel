import { describe, it, expect } from "vitest"

import { eventsOnDate } from "@/components/pricing/pricing-constants"
import { getMockEvents, mockPricingCalendar, mockRoomTypes } from "./demo-data"
import { demoClassifyDay, enrichMockPricingCalendar, mockPricingCalendarForRoomType, importMockEvents, importMockNewHotels, getMockNewHotels, mockBookingCurveDetail, mockDailyPerformance, mockDayOfWeekBreakdown, mockDayTypeBreakdown, mockMonthPace } from "./demo-revenue"

// デモモードのデータ（2026-10）。日のタイプはバックエンド（services/forecast/dayType.ts）と同じ手順で判定する（型はデモ用の固定）

describe("demoClassifyDay（バックエンドの classifyDay と同じ手順・型は固定）", () => {
  it("結果は最終の稼働率、予約の記録はその残日数の典型の予約室数、無ければ予測稼働率で一番近い型にする", () => {
    const weekday = new Date(2026, 10, 18) // 2026-11-18（水）
    const saturday = new Date(2026, 10, 21)
    const holiday = new Date(2026, 10, 3) // 文化の日
    expect(demoClassifyDay(weekday, { lead: 0, otbRooms: 140, finalRooms: 140 })?.name).toBe("平日B型") // 70%
    expect(demoClassifyDay(saturday, { lead: 0, otbRooms: 188, finalRooms: 188 })?.name).toBe("週末A型") // 94%
    expect(demoClassifyDay(holiday, { lead: 0, otbRooms: 150, finalRooms: 150 })?.name).toBe("特日A型")
    // 予測だけの日（予約の記録なし）
    expect(demoClassifyDay(weekday, { lead: 200, otbRooms: null, predictedOccupancy: 0.6 })).toMatchObject({ name: "平日C型", model: "occupancy" })
    // 当日まで 0 日・予約の記録あり: 典型（割合 1）× 平均稼働 × 客室数 に一番近い型
    expect(demoClassifyDay(weekday, { lead: 0, otbRooms: 165 })?.name).toBe("平日A型")
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
      expect(d.dayType).toMatch(/^(平日|週末|特日)[A-C]型$/)
      expect(["occupancy", "balanced", "adr"]).toContain(d.dayTypeModel)
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
    // 先の日は予約実数（室数・稼働率だけ。予約の単価・売上は PMS 連携後）
    expect(p.days.every((d) => d.onHand != null && d.onHand.soldRooms != null && d.onHand.adr === null && d.onHand.revenue === null)).toBe(true)
  })
})

describe("mockDayOfWeekBreakdown / mockDayTypeBreakdown（当月以降は 実績＋予約）", () => {
  const today = new Date()
  const year = today.getFullYear()
  const month = today.getMonth() + 1

  it("曜日別は月の全日を7つに分け、販売室数 = 実績＋予約、ADR は結果の出た日だけ", () => {
    const p = mockDailyPerformance("demo", year, month)
    const b = mockDayOfWeekBreakdown("demo", year, month)
    expect(b.days.reduce((a, d) => a + d.days, 0)).toBe(p.days.length)
    const rooms = p.days.reduce((a, d) => a + (d.actual?.soldRooms ?? d.onHand?.soldRooms ?? 0), 0)
    expect(b.days.reduce((a, d) => a + d.soldRooms, 0)).toBe(rooms)
    expect(b.days.flatMap((d) => d.dates).sort()).toEqual(p.days.map((d) => d.date))
  })

  it("日のタイプ別は型の名前ごとに集計し、全日がどれかの型か型なしに入る", () => {
    const p = mockDailyPerformance("demo", year, month)
    const t = mockDayTypeBreakdown("demo", year, month)
    expect(t.types.length).toBeGreaterThan(0)
    expect(t.types.every((r) => /^(平日|週末|特日)[A-D]型$/.test(r.dayType))).toBe(true)
    expect(t.types.reduce((a, r) => a + r.days, 0) + t.untypedDays).toBe(p.days.length)
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

describe("getMockEvents / importMockEvents", () => {
  const today = new Date()
  const day15 = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-15`

  it("API と同じく日付を UTC の 0時で持つ（日本時間でも日付が前日にずれない）", () => {
    const events = getMockEvents("demo")
    for (const e of events) {
      expect(new Date(e.startDate).getUTCHours()).toBe(0)
      expect(new Date(e.endDate).getUTCHours()).toBe(0)
    }
    expect(eventsOnDate(events, day15).map((e) => e.name)).toContain("地域花火大会")
  })

  it("同じ名前・同じ開始日の行は上書きになり、取り込んだ日付も UTC の 0時になる", () => {
    const dry = importMockEvents("demo", [
      { name: "地域花火大会", type: "festival", startDate: day15, endDate: day15 },
      { name: "新しい展示会", type: "conference", startDate: "2027-01-10", endDate: "2027-01-11" },
    ], true)
    expect(dry).toMatchObject({ dryRun: true, total: 2, created: 1, updated: 1 })
    importMockEvents("demo", [{ name: "新しい展示会", type: "conference", startDate: "2027-01-10", endDate: "2027-01-11" }], false)
    const added = getMockEvents("demo").find((e) => e.name === "新しい展示会")
    expect(new Date(added!.startDate).toISOString()).toBe("2027-01-10T00:00:00.000Z")
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

describe("mockPricingCalendarForRoomType（日別価格カレンダーのタイプ切り替え — 2026-10-24）", () => {
  const today = new Date()
  const y = today.getFullYear()
  const m = today.getMonth() + 1
  const all = enrichMockPricingCalendar(mockPricingCalendar("demo", y, m))
  const types = mockRoomTypes("demo")

  it("タイプの室数で返し、予算は持たない（null）。日のタイプ・料金ランク・需要のアラートは ALL と同じ", () => {
    const type = types[2]
    const cal = mockPricingCalendarForRoomType("demo", y, m, type.id)
    expect(cal.totalRooms).toBe(type.count)
    expect(cal.roomType).toEqual({ id: type.id, name: type.name, count: type.count })
    cal.calendar.forEach((d, i) => {
      expect([d.budgetRooms, d.budgetOccupancy, d.budgetAdr, d.budgetRevenue]).toEqual([null, null, null, null])
      expect(d.dayType).toBe(all.calendar[i].dayType)
      expect(d.recommendedRank).toBe(all.calendar[i].recommendedRank)
      expect(d.demandLevel).toBe(all.calendar[i].demandLevel)
      if (d.predictedOccupancy != null) expect(d.predictedOccupancy).toBeLessThanOrEqual(1)
    })
  })

  it("全タイプの予約室数・AI の予測室数を足すと ALL とほぼ同じ（配分の丸めの差だけ）", () => {
    const byType = types.map((t) => mockPricingCalendarForRoomType("demo", y, m, t.id))
    all.calendar.forEach((d, i) => {
      if (d.onHandRooms != null) {
        const sum = byType.reduce((a, c) => a + (c.calendar[i].onHandRooms ?? 0), 0)
        expect(Math.abs(sum - d.onHandRooms)).toBeLessThanOrEqual(types.length)
      }
      if (d.predictedOccupancy != null) {
        const sum = byType.reduce((a, c, ti) => a + Math.round((c.calendar[i].predictedOccupancy ?? 0) * types[ti].count), 0)
        expect(Math.abs(sum - Math.round(d.predictedOccupancy * 200))).toBeLessThanOrEqual(types.length)
      }
    })
  })

  it("無いタイプはエラーにする", () => {
    expect(() => mockPricingCalendarForRoomType("demo", y, m, "no-such-type")).toThrow("部屋タイプが見つかりません")
  })
})
