import { describe, it, expect } from "vitest"

import { buildDayCurveRows, buildDayTypeInsights, buildExternalFactors } from "./day-analysis-sections"
import type { BookingCurve, DayInsight } from "@/lib/api"

// 日のAI分析の部品（2026-10 PDF b03）: グラフの行、外部要因、日のタイプの見立て

const insight = (over: Partial<DayInsight> = {}): DayInsight => ({
  date: "2026-11-20",
  category: "平日",
  dayType: { name: "平日B型", model: "occupancy", typicalOccupancy: 0.62 },
  modelApplied: true,
  history: [{ daysBefore: 90, dayType: "平日A型", otbRooms: 30 }],
  typeProfile: {
    name: "平日B型",
    model: "occupancy",
    days: 40,
    avgOccupancy: 0.62,
    minOccupancy: 0.55,
    maxOccupancy: 0.7,
    avgAdr: 15000,
    referenceCurve: [
      { daysBefore: 30, roomsBooked: 60 },
      { daysBefore: 0, roomsBooked: 124 },
    ],
  },
  categoryTypes: [],
  similarDays: [],
  events: [],
  weather: null,
  ...over,
})

const curve: BookingCurve = {
  hotelId: "h",
  stayDate: "2026-11-20",
  totalRooms: 200,
  points: [
    { daysBefore: 30, roomsBooked: 50, occupancy: 0.25 },
    { daysBefore: 7, roomsBooked: 90, occupancy: 0.45 },
  ],
  reference: { date: "2025-11-21", points: [{ daysBefore: 30, roomsBooked: 45, occupancy: 0.225 }], finalRooms: 120, finalOccupancy: 0.6, adr: 15000 },
  breakdowns: {
    roomType: [{ label: "スタンダード", points: [{ daysBefore: 30, roomsBooked: 25, adr: 14000 }] }],
    guests: [],
  },
}

describe("buildDayCurveRows", () => {
  it("合計: 予約室数・前年同曜日・型の典型を残日数ごとに並べる（残日数の大きい順）", () => {
    const { rows, series } = buildDayCurveRows("total", curve, insight())
    expect(series.map((s) => s.label)).toEqual(["予約室数", "前年同曜日", "型の典型（平日B型）"])
    expect(rows.map((r) => r.daysBefore)).toEqual([30, 7, 0])
    expect(rows[0]).toMatchObject({ rooms: 50, lastYear: 45, typical: 60 })
  })

  it("タイプ別・利用人数別は内訳の室数と ADR。予約明細が無ければ系列は空", () => {
    const byType = buildDayCurveRows("roomType", curve, insight())
    expect(byType.series.map((s) => s.label)).toEqual(["スタンダード", "スタンダード ADR"])
    expect(byType.rows[0]).toMatchObject({ rooms0: 25, adr0: 14000 })
    expect(buildDayCurveRows("guests", curve, insight()).series).toEqual([])
  })
})

describe("buildExternalFactors", () => {
  it("イベントと天候を項目別に。イベントが無ければその旨、天候は未連携と出す", () => {
    expect(buildExternalFactors(insight())).toEqual([
      { label: "イベント", items: ["登録されたイベントはありません（外部需要動向で登録できます）"] },
      { label: "天候（台風・豪雨・大雪など）", items: ["天候データは未連携です（外部データの取り込み後に表示します）"] },
    ])
    const withEvent = buildExternalFactors(insight({ events: [{ name: "年末年始", type: "holiday", location: null, expectedImpact: null, excludeFromHistory: true }] }))
    expect(withEvent[0].items).toEqual(["年末年始・特殊日"])
  })
})

describe("buildDayTypeInsights", () => {
  it("今の型と優先モデル、推移で型が下がったことを伝える", () => {
    const items = buildDayTypeInsights(insight())
    expect(items[0].title).toBe("この日は「平日B型」・稼働優先")
    expect(items[1]).toMatchObject({ type: "negative", title: "予約の入りが弱く、型が下がりました" })
  })

  it("型を作れていない日は何も出さない", () => {
    expect(buildDayTypeInsights(insight({ dayType: null }))).toEqual([])
  })
})
