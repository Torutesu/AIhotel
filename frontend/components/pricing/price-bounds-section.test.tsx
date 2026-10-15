import { describe, it, expect } from "vitest"

import { describePriceBound, validatePriceBoundDraft } from "./price-bounds-section"
import { paceNote } from "./day-detail-dialog"
import { defaultSaleOpenMonth } from "./sale-open-check-card"
import type { RecommendationRationale } from "@/lib/api"

// 価格の幅・予約の入り方・販売開始チェック（D-11）の表示ヘルパー

describe("validatePriceBoundDraft", () => {
  const base = { startDate: "2026-12-01", endDate: "2026-12-31", weekdays: [], minRank: "", maxRank: "", reason: "" }
  it("期間と、下限・上限の少なくとも一方が必要", () => {
    expect(validatePriceBoundDraft({ ...base, startDate: "" })).toContain("開始日と終了日")
    expect(validatePriceBoundDraft(base)).toContain("少なくとも一方")
    expect(validatePriceBoundDraft({ ...base, minRank: "20" })).toBeNull()
  })
  it("範囲と大小を確かめる", () => {
    expect(validatePriceBoundDraft({ ...base, startDate: "2027-01-01" })).toContain("開始日は終了日以前")
    expect(validatePriceBoundDraft({ ...base, minRank: "41" })).toContain("1〜40")
    expect(validatePriceBoundDraft({ ...base, minRank: "30", maxRank: "20" })).toContain("下限は上限以下")
  })
})

describe("describePriceBound", () => {
  it("曜日と幅を短く書く", () => {
    expect(describePriceBound({ weekdays: [5, 6], minRank: 20, maxRank: 38 })).toBe("金・土 R20〜R38")
    expect(describePriceBound({ weekdays: [], minRank: 30, maxRank: null })).toBe("全日 下限 R30")
    expect(describePriceBound({ weekdays: [0], minRank: null, maxRank: 5 })).toBe("日 上限 R05")
  })
})

describe("paceNote", () => {
  const rationale = (adjustments: RecommendationRationale["adjustments"]): RecommendationRationale => ({
    version: 1,
    modelVersion: "rule-based-v4",
    recommendedRank: 10,
    factors: [],
    adjustments,
    excluded: [],
    guardrails: [],
  })
  it("前年同曜日と比べたペースを一文にする", () => {
    const note = paceNote(
      rationale([{ key: "pace", impact: 0.1, input: { leadDays: 30, otbRooms: 60, lastYearOtbRooms: 40, ratio: 1.5 } }]),
    )
    expect(note).toBe("残り30日で60室の予約（前年同曜日の同じ時点は40室、ペース150%）。宿泊日が近いほど予約の入り方を重く見ます。")
  })
  it("予約済みの下限と、材料の無いとき", () => {
    expect(paceNote(rationale([{ key: "otbFloor", impact: 0.2, input: { leadDays: 5, otbRooms: 96 } }]))).toContain("すでに96室")
    expect(paceNote(rationale([{ key: "weekend", impact: 0.05 }]))).toBeNull()
  })
})

describe("defaultSaleOpenMonth", () => {
  it("今日から11か月先の月", () => {
    expect(defaultSaleOpenMonth(new Date(2026, 9, 15))).toBe("2027-09")
    expect(defaultSaleOpenMonth(new Date(2026, 0, 31))).toBe("2026-12")
  })
})
