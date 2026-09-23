import { describe, it, expect } from "vitest"
import {
  COMPETITOR_PRICE_CSV_TEMPLATE,
  OTB_CSV_TEMPLATE,
  parseCompetitorPriceCsv,
  parseObservedAt,
  parseOtbCsv,
} from "@/lib/import-csv"

describe("parseCompetitorPriceCsv（#9）", () => {
  it("テンプレートをそのまま読める（取得元は日本語名、取得日時は日本時間とみなす）", () => {
    const { rows, errors } = parseCompetitorPriceCsv(COMPETITOR_PRICE_CSV_TEMPLATE)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual({
      competitorName: "ホテルA",
      date: "2026-10-01",
      price1P: 12000,
      price2P: 18000,
      price3P: null,
      soldOut: false,
      source: "rakuten",
      observedAt: "2026-09-23T03:00:00+09:00",
    })
    expect(rows[2]).toMatchObject({ competitorName: "ホテルB", soldOut: true, price1P: null, source: "official" })
  })

  it("英語の見出し・取得元キー・任意列の省略も受け付け、形式の誤りは行番号つきで返す", () => {
    const csv = "competitorName,date,price1P,source\nA,2026/10/1,\"12,000\",booking\nB,10/1,abc,unknown\n"
    const { rows, errors } = parseCompetitorPriceCsv(csv)
    expect(rows).toEqual([{ competitorName: "A", date: "2026-10-01", price1P: 12000, price2P: null, price3P: null, soldOut: false, source: "booking" }])
    expect(errors).toHaveLength(1)
    expect(errors[0].line).toBe(3)
    expect(errors[0].message).toContain("宿泊日")
    expect(errors[0].message).toContain("料金")
    expect(errors[0].message).toContain("取得元")
  })

  it("必須列（競合ホテル名・宿泊日・1名料金）が無ければ見出しのエラー", () => {
    expect(parseCompetitorPriceCsv("宿泊日,2名料金\n2026-10-01,1\n").errors[0].message).toContain("競合ホテル名・1名料金")
  })
})

describe("parseObservedAt", () => {
  it("時差の無い値は日本時間、Z や時差つきはそのまま。空は undefined、不正は null", () => {
    expect(parseObservedAt("2026/9/3 7:05")).toBe("2026-09-03T07:05:00+09:00")
    expect(parseObservedAt("2026-09-03T07:05:10Z")).toBe("2026-09-03T07:05:10Z")
    expect(parseObservedAt("")).toBeUndefined()
    expect(parseObservedAt("昨日")).toBeNull()
  })
})

describe("parseOtbCsv（#24 E2）", () => {
  it("テンプレートを読め、数値でない予約室数はエラーにする", () => {
    expect(parseOtbCsv(OTB_CSV_TEMPLATE)).toEqual({
      rows: [
        { stayDate: "2026-10-01", roomsBooked: 120 },
        { stayDate: "2026-10-02", roomsBooked: 98 },
      ],
      errors: [],
    })
    expect(parseOtbCsv("宿泊日,予約室数\n2026-10-01,多い\n").errors[0]).toEqual({ line: 2, message: "予約室数を数値で入力してください" })
  })
})
