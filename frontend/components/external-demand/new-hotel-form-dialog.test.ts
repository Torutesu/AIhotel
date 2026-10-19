import { describe, it, expect } from "vitest"

import { newHotelFormSchema, toNewHotelInput } from "./new-hotel-form-dialog"

// 周辺の新規ホテルの登録フォーム（2026-10）

const base = {
  name: "ステーションホテル新館",
  openingDate: "2026-12-01",
  rooms: "",
  category: "",
  location: "",
  distanceKm: "",
  expectedImpact: "none" as const,
  notes: "",
}

describe("newHotelFormSchema", () => {
  it("ホテル名と開業日は必須、客室数・距離は空欄なら省略", () => {
    expect(newHotelFormSchema.safeParse(base).success).toBe(true)
    expect(newHotelFormSchema.safeParse({ ...base, name: " " }).success).toBe(false)
    expect(newHotelFormSchema.safeParse({ ...base, openingDate: "" }).success).toBe(false)
  })
  it("客室数は1以上の整数、距離は0以上", () => {
    expect(newHotelFormSchema.safeParse({ ...base, rooms: "0" }).success).toBe(false)
    expect(newHotelFormSchema.safeParse({ ...base, rooms: "12.5" }).success).toBe(false)
    expect(newHotelFormSchema.safeParse({ ...base, rooms: "220", distanceKm: "0.4" }).success).toBe(true)
    expect(newHotelFormSchema.safeParse({ ...base, distanceKm: "-1" }).success).toBe(false)
    expect(newHotelFormSchema.safeParse({ ...base, distanceKm: "abc" }).success).toBe(false)
  })
})

describe("toNewHotelInput", () => {
  it("空欄は null、影響度の未設定は null にして API の形にする", () => {
    expect(toNewHotelInput(base)).toEqual({
      name: "ステーションホテル新館",
      openingDate: "2026-12-01",
      rooms: null,
      category: null,
      location: null,
      distanceKm: null,
      expectedImpact: null,
      notes: null,
    })
    expect(toNewHotelInput({ ...base, rooms: "220", distanceKm: "0.4", expectedImpact: "high", category: " ビジネス " })).toMatchObject({
      rooms: 220,
      distanceKm: 0.4,
      expectedImpact: "high",
      category: "ビジネス",
    })
  })
})
