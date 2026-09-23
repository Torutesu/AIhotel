import { describe, it, expect } from "vitest"

import { DAILY_DATA_CSV_TEMPLATE, parseDailyDataCsv } from "@/lib/daily-data-csv"

describe("parseDailyDataCsv（#82）", () => {
  it("テンプレートをそのまま読める", () => {
    const { rows, errors } = parseDailyDataCsv(DAILY_DATA_CSV_TEMPLATE)
    expect(errors).toEqual([])
    expect(rows).toEqual([
      { date: "2026-09-01", soldRooms: 80, totalRevenue: 1_600_000, guests: 150 },
      { date: "2026-09-02", soldRooms: 65, totalRevenue: 1_235_000, guests: 120 },
    ])
  })

  it("Excel 保存の BOM・CRLF・桁区切り・スラッシュ区切りの日付・列の並び替え・英語見出しを受け付ける", () => {
    const text = '﻿totalRevenue,date,soldRooms\r\n"1,600,000",2026/9/1,80\r\n\r\n'
    expect(parseDailyDataCsv(text)).toEqual({
      rows: [{ date: "2026-09-01", soldRooms: 80, totalRevenue: 1_600_000, guests: null }],
      errors: [],
    })
  })

  it("形式の誤りはファイル上の行番号つきで返す", () => {
    const text = "日付,販売室数,室料売上\n2026-09-01,80,1600000\n9月2日,abc,\n"
    const { rows, errors } = parseDailyDataCsv(text)
    expect(rows).toHaveLength(1)
    expect(errors).toEqual([
      {
        line: 3,
        message:
          "日付は YYYY-MM-DD または YYYY/M/D 形式で入力してください／販売室数を数値で入力してください／室料売上を数値で入力してください",
      },
    ])
  })

  it("必要な列が無ければ見出し行のエラーにする", () => {
    const { errors } = parseDailyDataCsv("日付,販売室数\n2026-09-01,1\n")
    expect(errors[0]).toMatchObject({ line: 1 })
    expect(errors[0].message).toContain("室料売上")
  })
})
