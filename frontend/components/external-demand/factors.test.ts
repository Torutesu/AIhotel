import { describe, it, expect } from "vitest"

import { toCsv } from "@/lib/csv-export"
import { factorsToCsvRows } from "./factors"

// 外部需要動向の要因一覧の CSV（D-13 で実データに）。出どころ（AI収集・気象庁）と根拠の URL を付ける

describe("factorsToCsvRows", () => {
  it("指標1つにつき1行、指標の無い要因は1行にし、出どころと根拠の URL を付ける", () => {
    const rows = factorsToCsvRows("インバウンド", [
      {
        name: "訪日客数",
        status: "positive",
        trend: "up",
        note: "前年を上回る",
        source: "agent",
        sourceUrl: "https://example.com/jnto",
        kpis: [
          { label: "期間", value: "12/1〜2/28" },
          { label: "稼働率予測への補正", value: "+3pt", hint: "合計は ±6pt まで" },
        ],
      },
      { name: "今後7日の天気", status: "normal", trend: "neutral", note: "雨の予報なし", source: "jma" },
    ])
    expect(rows[0]).toEqual(["出どころ", "区分", "項目", "状況", "傾向", "内容", "指標", "値", "補足", "根拠のURL"])
    expect(rows.slice(1)).toEqual([
      ["AI収集", "インバウンド", "訪日客数", "追い風", "上向き", "前年を上回る", "期間", "12/1〜2/28", "", "https://example.com/jnto"],
      ["AI収集", "インバウンド", "訪日客数", "追い風", "上向き", "前年を上回る", "稼働率予測への補正", "+3pt", "合計は ±6pt まで", "https://example.com/jnto"],
      ["気象庁", "インバウンド", "今後7日の天気", "通常", "横ばい", "雨の予報なし", "", "", "", ""],
    ])
    // 単位つきの符号は数式と読まれないよう ' を付ける
    expect(toCsv(rows)).toContain(",'+3pt,")
  })
})
