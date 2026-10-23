import { describe, it, expect } from "vitest"

import { alertLinkFor, isMonthLevelAlert, resolveAlertLink } from "./alert-link"

// アラートの遷移先（F-4）。先々のアラートを今月の画面で開かないよう、対象日・対象月の年月で遷移する（2026-10-23 a01）

describe("isMonthLevelAlert", () => {
  it("ruleKey が \":yyyy-MM\" で終わるものを月単位のアラートとみなす", () => {
    expect(isMonthLevelAlert("LANDING_BELOW_BUDGET:2026-11")).toBe(true)
    expect(isMonthLevelAlert("DEMO_WEEKDAY_PACE:2026-11")).toBe(true)
    expect(isMonthLevelAlert("HIGH_DEMAND")).toBe(false)
    expect(isMonthLevelAlert(null)).toBe(false)
    expect(isMonthLevelAlert(undefined)).toBe(false)
  })
})

describe("alertLinkFor", () => {
  it("料金設定へは対象日の年月で開き、その日を強調する（API の ISO 文字列・デモの日付のどちらも）", () => {
    expect(alertLinkFor({ linkTab: "pricing", targetDate: "2026-12-02T00:00:00.000Z" })).toEqual({
      tab: "pricing",
      label: "料金設定へ",
      periodMonth: "2026-12",
      focusDate: "2026-12-02",
    })
    expect(alertLinkFor({ linkTab: "pricing", targetDate: "2026-12-02" })?.focusDate).toBe("2026-12-02")
  })

  it("月単位のアラートは年月だけで開き、1日を強調しない", () => {
    expect(alertLinkFor({ linkTab: "pricing", targetDate: "2026-11-01T00:00:00.000Z", ruleKey: "LANDING_BELOW_BUDGET:2026-11" })).toEqual({
      tab: "pricing",
      label: "料金設定へ",
      periodMonth: "2026-11",
    })
  })

  it("分析は年月とビュー、対象日の無いアラート・対象年月の無い画面はそのまま", () => {
    expect(alertLinkFor({ linkTab: "daily", targetDate: "2026-11-05" })).toEqual({
      tab: "analysis",
      analysisView: "performance",
      label: "日別分析へ",
      periodMonth: "2026-11",
    })
    expect(alertLinkFor({ linkTab: "pricing", targetDate: null })).toEqual(resolveAlertLink("pricing"))
    expect(alertLinkFor({ linkTab: "settings", targetDate: "2026-11-05" })).toEqual(resolveAlertLink("settings"))
    expect(alertLinkFor({ linkTab: "unknown", targetDate: "2026-11-05" })).toBeNull()
  })
})
