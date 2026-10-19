import { describe, it, expect } from "vitest"

import { toCsv, csvCell } from "@/lib/csv-export"
import { readCsvTable } from "@/lib/csv"
import {
  EVENT_CSV_TEMPLATE,
  NEW_HOTEL_CSV_TEMPLATE,
  eventsToCsvRows,
  newHotelsToCsvRows,
  parseEventCsv,
  parseNewHotelCsv,
} from "@/lib/external-demand-csv"
import type { Event as HotelEvent } from "@shared/types"

// 外部需要動向の規定フォーム（イベント・新規ホテル）と一覧の CSV 出力（2026-10）

describe("csvCell / toCsv", () => {
  it("カンマ・ダブルクォート・改行を含むセルだけを囲む", () => {
    expect(csvCell("花火大会")).toBe("花火大会")
    expect(csvCell("参加者 3,000人")).toBe('"参加者 3,000人"')
    expect(csvCell('"特別"公演')).toBe('"""特別""公演"')
    expect(csvCell(null)).toBe("")
    expect(csvCell(true)).toBe("○")
    expect(csvCell(false)).toBe("")
    expect(toCsv([["a", 1], ["b", null]])).toBe("a,1\r\nb,\r\n")
  })

  it("= + - @ で始まる文字列は先頭に ' を付けて数式として実行させない（数値・数値だけの文字列はそのまま）", () => {
    expect(csvCell("=HYPERLINK(\"http://example.com\")")).toBe('"\'=HYPERLINK(""http://example.com"")"')
    expect(csvCell("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0")
    expect(csvCell("-2+3")).toBe("'-2+3")
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)")
    expect(csvCell("+2.8pt")).toBe("'+2.8pt")
    expect(csvCell("+12.4%")).toBe("+12.4%")
    expect(csvCell("-3")).toBe("-3")
    expect(csvCell(-5)).toBe("-5")
    expect(csvCell("花火-大会")).toBe("花火-大会")
  })
})

describe("readCsvTable", () => {
  it("ダブルクォート内の改行はセルの中の改行として読み、行番号はその行の始まりにする", () => {
    const { lines, errors } = readCsvTable('名前,メモ\r\nA,"1行目\r\n2行目"\r\nB,x\r\n', { name: ["名前", "名前"], memo: ["メモ", "メモ"] }, ["name"])
    expect(errors).toEqual([])
    expect(lines).toEqual([
      { line: 2, cells: ["A", "1行目\n2行目"] },
      { line: 4, cells: ["B", "x"] },
    ])
  })

  it("書き出しで付けた先頭の ' を外して読む（' のあとが = + - @ のときだけ）", () => {
    const { lines } = readCsvTable("名前\n'=1+1\n'abc\n", { name: ["名前", "名前"] }, ["name"])
    expect(lines.map((l) => l.cells[0])).toEqual(["=1+1", "'abc"])
  })
})

describe("parseEventCsv", () => {
  it("テンプレートをそのまま読める（種別・影響度の日本語名、特殊日の ○）", () => {
    const { rows, errors } = parseEventCsv(EVENT_CSV_TEMPLATE)
    expect(errors).toEqual([])
    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual({
      name: "市民花火大会",
      type: "festival",
      startDate: "2026-11-08",
      endDate: "2026-11-08",
      location: "河川敷",
      expectedImpact: "high",
      description: "雨天時は翌日",
      excludeFromHistory: false,
    })
    expect(rows[2]).toMatchObject({ type: "holiday", startDate: "2026-12-29", endDate: "2027-01-03", excludeFromHistory: true })
  })

  it("英語の見出し・コード・スラッシュ区切りの日付も受け付け、終了日が空なら開始日にする", () => {
    const { rows, errors } = parseEventCsv("name,type,startDate,expectedImpact\n学会,conference,2026/11/5,medium\n")
    expect(errors).toEqual([])
    expect(rows[0]).toMatchObject({ name: "学会", type: "conference", startDate: "2026-11-05", endDate: "2026-11-05", expectedImpact: "medium" })
  })

  it("不正な行は行番号つきで返し、正しい行だけを rows に入れる", () => {
    const text =
      "イベント名,種別,開始日,終了日,影響度,特殊日\n" +
      ",祭り・催事,2026-11-01,,,\n" +
      "逆転,祭り・催事,2026-11-09,2026-11-08,,\n" +
      "種別違い,ライブ,2026-11-10,,特大,たぶん\n" +
      "正しい,スポーツ,2026-11-11,,低,\n"
    const { rows, errors } = parseEventCsv(text)
    expect(rows.map((r) => r.name)).toEqual(["正しい"])
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4])
    expect(errors[0].message).toContain("イベント名を入力")
    expect(errors[1].message).toContain("終了日は開始日以降")
    expect(errors[2].message).toContain("種別は")
    expect(errors[2].message).toContain("影響度は")
    expect(errors[2].message).toContain("特殊日は")
  })

  it("必須の見出しが無ければ1行目のエラーにする", () => {
    expect(parseEventCsv("名前,日付\nx,2026-11-01\n").errors[0]).toMatchObject({ line: 1 })
  })

  it("一覧の CSV 出力を読み直すと同じ内容に戻る（出力したファイルをそのまま取り込める）", () => {
    const events = [
      {
        id: "e1",
        hotelId: "h",
        name: "アリーナ公演",
        type: "concert",
        startDate: new Date("2026-11-21T00:00:00Z"),
        endDate: new Date("2026-11-22T00:00:00Z"),
        location: "市営アリーナ, 北口",
        expectedImpact: "medium",
        description: "2日間",
        excludeFromHistory: false,
      },
      {
        id: "e2",
        hotelId: "h",
        name: "台風",
        type: "weather",
        startDate: "2026-09-01T00:00:00.000Z",
        endDate: "2026-09-02T00:00:00.000Z",
        excludeFromHistory: true,
      },
    ] as unknown as HotelEvent[]
    const { rows, errors } = parseEventCsv(toCsv(eventsToCsvRows(events)))
    expect(errors).toEqual([])
    expect(rows).toEqual([
      { name: "アリーナ公演", type: "concert", startDate: "2026-11-21", endDate: "2026-11-22", location: "市営アリーナ, 北口", expectedImpact: "medium", description: "2日間", excludeFromHistory: false },
      { name: "台風", type: "weather", startDate: "2026-09-01", endDate: "2026-09-02", excludeFromHistory: true },
    ])
  })
})

describe("parseNewHotelCsv", () => {
  it("テンプレートを読める", () => {
    const { rows, errors } = parseNewHotelCsv(NEW_HOTEL_CSV_TEMPLATE)
    expect(errors).toEqual([])
    expect(rows[0]).toEqual({
      name: "ステーションホテル新館",
      openingDate: "2026-12-01",
      rooms: 220,
      category: "ビジネス",
      location: "駅北口",
      distanceKm: 0.4,
      expectedImpact: "high",
      notes: "同価格帯",
    })
    expect(rows[1]).toMatchObject({ expectedImpact: "medium", notes: null })
  })

  it("客室数・距離・影響度の誤りを行ごとに返す", () => {
    const { rows, errors } = parseNewHotelCsv("ホテル名,開業日,客室数,距離(km),影響度\nA,2026-12-01,0,,\nB,2026-12-01,10.5,-1,大\nC,来月,,,\n")
    expect(rows).toEqual([])
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4])
    expect(errors[1].message).toContain("客室数は1以上の整数")
    expect(errors[1].message).toContain("距離は0以上")
    expect(errors[2].message).toContain("開業日")
  })

  it("一覧の CSV 出力を読み直すと同じ内容に戻る", () => {
    const hotels = [
      { id: "1", hotelId: "h", name: "リゾート南", openingDate: "2027-03-15", rooms: 310, category: "リゾート", location: null, distanceKm: 3.2, expectedImpact: "low" as const, notes: null },
    ]
    const { rows } = parseNewHotelCsv(toCsv(newHotelsToCsvRows(hotels)))
    expect(rows).toEqual([
      { name: "リゾート南", openingDate: "2027-03-15", rooms: 310, category: "リゾート", location: null, distanceKm: 3.2, expectedImpact: "low", notes: null },
    ])
  })

  it("改行を含むメモ・= で始まる名前も、出力して読み直すと同じ内容に戻る", () => {
    const hotels = [
      { id: "1", hotelId: "h", name: "=新館", openingDate: "2027-03-15", rooms: 120, category: null, location: "駅前, 東口", distanceKm: null, expectedImpact: null, notes: "1行目\n2行目は \"引用\"" },
      { id: "2", hotelId: "h", name: "リゾート南", openingDate: "2027-04-01", rooms: 310, category: "リゾート", location: null, distanceKm: 3.2, expectedImpact: "low" as const, notes: null },
    ]
    const { rows, errors } = parseNewHotelCsv(toCsv(newHotelsToCsvRows(hotels)))
    expect(errors).toEqual([])
    expect(rows).toEqual([
      { name: "=新館", openingDate: "2027-03-15", rooms: 120, category: null, location: "駅前, 東口", distanceKm: null, expectedImpact: null, notes: "1行目\n2行目は \"引用\"" },
      { name: "リゾート南", openingDate: "2027-04-01", rooms: 310, category: "リゾート", location: null, distanceKm: 3.2, expectedImpact: "low", notes: null },
    ])
  })
})
