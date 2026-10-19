import { describe, it, expect } from "vitest"

import { buildDayPaceRows, buildMonthPaceRows, buildVarianceRows, differenceOf, summarizeVariance, yearOverYearOf } from "./performance-variance"
import type { BookingCurve, DailyPerformanceDay, DayMetrics } from "@/lib/api"

// 日別パフォーマンスの差異（実績 − 予算・AI、前年比）と日のグラフ（2026-10）

const m = (soldRooms: number, adr: number, totalRooms = 100): DayMetrics => ({
  soldRooms,
  occupancy: soldRooms / totalRooms,
  adr,
  revPar: (soldRooms * adr) / totalRooms,
  revenue: soldRooms * adr,
})

describe("differenceOf / yearOverYearOf", () => {
  it("差異は 実績 − 相手（稼働率は 0〜1 の差、それ以外は円）", () => {
    const d = differenceOf(m(80, 12000), m(70, 11000))
    expect(d.occupancy).toBeCloseTo(0.1)
    expect(d.adr).toBe(1000)
    expect(d.revenue).toBe(80 * 12000 - 70 * 11000)
    expect(differenceOf(null, m(70, 11000)).revenue).toBeNull()
  })
  it("前年比は稼働率が pt 差、ほかは伸び率", () => {
    const y = yearOverYearOf(m(80, 12000), m(64, 10000))
    expect(y.occupancy).toBeCloseTo(0.16)
    expect(y.adr).toBeCloseTo(0.2)
    expect(y.revenue).toBeCloseTo((80 * 12000) / (64 * 10000) - 1)
  })
})

describe("buildVarianceRows / summarizeVariance", () => {
  const days: DailyPerformanceDay[] = [
    { date: "2026-10-01", actual: m(80, 12000), budget: m(70, 10000), ai: m(75, 11000), lastYearDate: "2025-10-02", lastYear: m(60, 10000) },
    { date: "2026-10-02", actual: m(60, 10000), budget: m(70, 10000), ai: null, lastYearDate: "2025-10-03", lastYear: null },
    { date: "2026-10-03", actual: null, budget: m(70, 10000), ai: m(75, 11000), lastYearDate: "2025-10-04", lastYear: m(60, 10000) },
  ]

  it("結果の出ていない日は差異を出さない", () => {
    const rows = buildVarianceRows(days)
    expect(rows[0]).toMatchObject({ day: 1, dow: 4, hasActual: true })
    expect(rows[0].budget.adr).toBe(2000)
    expect(rows[1].ai.revenue).toBeNull()
    expect(rows[2]).toMatchObject({ hasActual: false })
    expect(rows[2].budget.revenue).toBeNull()
  })

  it("月計は結果の出た日だけ、相手のある日どうしで足し上げてから差を取る", () => {
    const s = summarizeVariance(days, 100)
    expect(s.days).toBe(2)
    expect(s.actual).toMatchObject({ soldRooms: 140, revenue: 80 * 12000 + 60 * 10000 })
    expect(s.actual?.occupancy).toBeCloseTo(0.7)
    // 予算: 2日とも → 実績 1,560,000 − 予算 1,400,000
    expect(s.budget.revenue).toBe(160000)
    // AI: 1日目だけ → 960,000 − 825,000
    expect(s.ai.revenue).toBe(135000)
    // 前年: 1日目だけ → 960,000 / 600,000 − 1
    expect(s.yoy.revenue).toBeCloseTo(0.6)
  })
})

describe("buildDayPaceRows（日のグラフ）", () => {
  const curve: BookingCurve = {
    hotelId: "h",
    stayDate: "2026-10-10",
    totalRooms: 100,
    points: [
      { daysBefore: 200, roomsBooked: 1, occupancy: 0.01 },
      { daysBefore: 90, roomsBooked: 20, occupancy: 0.2 },
      { daysBefore: 30, roomsBooked: 50, occupancy: 0.5 },
    ],
    reference: { date: "2025-10-11", points: [{ daysBefore: 90, roomsBooked: 16, occupancy: 0.16 }, { daysBefore: 30, roomsBooked: 2, occupancy: 0.02 }], finalRooms: 70, finalOccupancy: 0.7, adr: 10000 },
    budget: { rooms: 75, occupancy: 0.75, adr: 12000 },
    prediction: { occupancy: 0.8, rooms: 80, adr: 12000 },
    actual: { soldRooms: 82, occupancy: 0.82, adr: 12500 },
  }

  it("180日前より古い記録は外し、結果の出た日は残日数0に結果を置く", () => {
    const rows = buildDayPaceRows(curve)
    expect(rows.map((r) => r.daysBefore)).toEqual([90, 30, 0])
    expect(rows[0].budget).toBeCloseTo(0.2 - 0.75)
    expect(rows[0].ai).toBeCloseTo(0.2 - 0.8)
    expect(rows[0].yoy).toBeCloseTo(20 / 16 - 1)
    // 前年の予約が3室未満なら比べない
    expect(rows[1].yoy).toBeNull()
    // 結果 82室 vs 前年の最終 70室
    expect(rows[2].yoy).toBeCloseTo(82 / 70 - 1)
    expect(rows[2].budget).toBeCloseTo(0.07)
  })
})

describe("buildMonthPaceRows（月のグラフ — 月全体の 180日前 → 結果）", () => {
  it("月の予約の稼働率を予算・AI の予測と比べ、前年同曜日の同じ時点との比を出す", () => {
    const rows = buildMonthPaceRows({
      hotelId: "h",
      year: 2026,
      month: 9,
      totalRooms: 100,
      days: 30,
      budgetRooms: 2340,
      budgetOccupancy: 0.78,
      aiRooms: 2100,
      aiOccupancy: 0.7,
      points: [
        { daysBefore: 90, rooms: 660, occupancy: 0.22, comparableRooms: 660, lastYearRooms: 600 },
        { daysBefore: 0, rooms: 2085, occupancy: 0.695, comparableRooms: 2000, lastYearRooms: 2 },
      ],
    })
    expect(rows[0].daysBefore).toBe(90)
    expect(rows[0].budget).toBeCloseTo(0.22 - 0.78)
    expect(rows[0].ai).toBeCloseTo(0.22 - 0.7)
    expect(rows[0].yoy).toBeCloseTo(0.1)
    // 前年の予約が少なすぎれば比べない
    expect(rows[1].yoy).toBeNull()
  })
})
