import { describe, it, expect } from "vitest"

import {
  DAY_NAMES,
  DEFAULT_WEEKEND_DAYS,
  daysInMonth,
  isWeekendDate,
  isWeekendDow,
  monthLabel,
  monthRange,
  parseMonthStr,
  parseWeekendDays,
  startOfToday,
  toDateStr,
  toMonthStr,
  weekendDaysLabel,
} from "./date"

describe("toDateStr / toMonthStr", () => {
  it("ローカル時刻基準で yyyy-MM-dd / yyyy-MM に整形する", () => {
    const date = new Date(2026, 8, 5) // 2026-09-05（ローカル）
    expect(toDateStr(date)).toBe("2026-09-05")
    expect(toMonthStr(date)).toBe("2026-09")
  })

  it("月・日を2桁にゼロ埋めする", () => {
    expect(toDateStr(new Date(2026, 0, 1))).toBe("2026-01-01")
  })

  it("UTC ではなくローカル日付を使う（日付がずれない）", () => {
    // 現地時刻 23:30 でも同じ日付になること（UTC 変換では翌日になり得る）
    const lateNight = new Date(2026, 8, 5, 23, 30)
    expect(toDateStr(lateNight)).toBe("2026-09-05")
  })
})

describe("parseMonthStr", () => {
  it("yyyy-MM を年と月に分解する", () => {
    expect(parseMonthStr("2026-09")).toEqual({ year: 2026, month: 9 })
  })

  it("不正な値は現在の年月にフォールバックする", () => {
    const now = new Date()
    const fallback = { year: now.getFullYear(), month: now.getMonth() + 1 }
    expect(parseMonthStr("")).toEqual(fallback)
    expect(parseMonthStr("2026-13")).toEqual(fallback)
    expect(parseMonthStr("not-a-month")).toEqual(fallback)
  })
})

describe("monthRange / daysInMonth / monthLabel", () => {
  it("対象月の初日と末日を返す", () => {
    expect(monthRange(2026, 9)).toEqual({ startDate: "2026-09-01", endDate: "2026-09-30" })
  })

  it("うるう年の2月を正しく扱う", () => {
    expect(monthRange(2024, 2).endDate).toBe("2024-02-29")
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2026, 2)).toBe(28)
  })

  it("日本語のラベルを返す", () => {
    expect(monthLabel(2026, 9)).toBe("2026年9月")
  })
})

describe("parseWeekendDays（Hotel.weekendDays の正規化 — U-6）", () => {
  it("0〜6 の整数だけを採用し、昇順・重複排除する", () => {
    expect(parseWeekendDays([6, 5, 5])).toEqual([5, 6])
  })

  it("範囲外・型違いの値を除外する", () => {
    expect(parseWeekendDays([5, 7, -1, "6", null, 1.5])).toEqual([5])
  })

  it("配列でない・有効値が無い場合は既定値（金・土）を返す", () => {
    expect(parseWeekendDays(null)).toEqual(DEFAULT_WEEKEND_DAYS)
    expect(parseWeekendDays([])).toEqual(DEFAULT_WEEKEND_DAYS)
    expect(parseWeekendDays(["土"])).toEqual(DEFAULT_WEEKEND_DAYS)
    expect(DEFAULT_WEEKEND_DAYS).toEqual([5, 6])
  })
})

describe("isWeekendDow / isWeekendDate / weekendDaysLabel", () => {
  it("週末定義はハードコードせず引数の配列で判定する", () => {
    expect(isWeekendDow(5, [5, 6])).toBe(true)
    expect(isWeekendDow(0, [5, 6])).toBe(false)
    // 土日を週末とする施設でも同じ関数で判定できる
    expect(isWeekendDow(0, [0, 6])).toBe(true)
  })

  it("日付からも判定できる", () => {
    // 2026-09-11 は金曜日
    const friday = new Date(2026, 8, 11)
    expect(friday.getDay()).toBe(DAY_NAMES.indexOf("金"))
    expect(isWeekendDate(friday, [5, 6])).toBe(true)
    expect(isWeekendDate(friday, [0, 6])).toBe(false)
  })

  it("読み上げ用のラベルにする", () => {
    expect(weekendDaysLabel([5, 6])).toBe("金・土")
    expect(weekendDaysLabel([])).toBe("設定なし")
  })
})

describe("startOfToday", () => {
  it("今日の0時（ローカル）を返す", () => {
    const start = startOfToday()
    const now = new Date()
    expect(start.getHours()).toBe(0)
    expect(start.getMinutes()).toBe(0)
    expect(toDateStr(start)).toBe(toDateStr(now))
  })
})
