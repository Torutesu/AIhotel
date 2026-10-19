import { describe, it, expect } from "vitest"

import { toCsv } from "@/lib/csv-export"
import { factorsToCsvRows } from "./factors"

// 外部需要動向の要因一覧の CSV（2026-10）。外部要因データは未取り込みのため、どの行にもサンプルと書く

describe("factorsToCsvRows", () => {
  it("指標1つにつき1行、指標の無い要因は1行にし、どの行にも「サンプル」と書く", () => {
    const rows = factorsToCsvRows("インバウンド", [
      { name: "訪日客数", status: "positive", trend: "up", note: "前年を上回る", kpis: [
        { label: "前年比（推定）", value: "+12.4%", hint: "直近3ヶ月" },
        { label: "需要寄与", value: "+2.8pt" },
      ] },
      { name: "為替", status: "normal", trend: "neutral", note: "横ばい" },
    ])
    expect(rows[0]).toEqual(["データ", "区分", "項目", "状況", "傾向", "内容", "指標", "値", "補足"])
    expect(rows.slice(1)).toEqual([
      ["サンプル", "インバウンド", "訪日客数", "好調", "上昇", "前年を上回る", "前年比（推定）", "+12.4%", "直近3ヶ月"],
      ["サンプル", "インバウンド", "訪日客数", "好調", "上昇", "前年を上回る", "需要寄与", "+2.8pt", ""],
      ["サンプル", "インバウンド", "為替", "通常", "横ばい", "横ばい", "", "", ""],
    ])
    // 単位つきの符号は数式と読まれないよう ' を付け、数値だけの値はそのまま書く
    const csv = toCsv(rows)
    expect(csv).toContain(",+12.4%,")
    expect(csv).toContain(",'+2.8pt,")
  })
})
