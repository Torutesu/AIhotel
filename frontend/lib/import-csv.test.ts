import { describe, it, expect } from "vitest"
import {
  BOOKING_CURVE_CSV_TEMPLATE,
  COMPETITOR_PRICE_CSV_TEMPLATE,
  DAILY_BUDGET_CSV_TEMPLATE,
  OTB_CSV_TEMPLATE,
  RESERVATION_CSV_TEMPLATE,
  parseReservationCsv,
  parseBookingCurveCsv,
  parseDailyBudgetCsv,
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

describe("parseBookingCurveCsv（D-13）", () => {
  it("テンプレートを読める（残日数の行と取得日の行）", () => {
    const { rows, errors } = parseBookingCurveCsv(BOOKING_CURVE_CSV_TEMPLATE)
    expect(errors).toEqual([])
    expect(rows).toEqual([
      { stayDate: "2025-10-01", daysBefore: 90, roomsBooked: 32 },
      { stayDate: "2025-10-01", daysBefore: 30, roomsBooked: 85 },
      { stayDate: "2025-10-01", daysBefore: 0, roomsBooked: 128 },
      { stayDate: "2025-10-02", capturedDate: "2025-07-01", roomsBooked: 20 },
    ])
  })

  it("残日数だけの見出し・英語の見出しも受け付け、不正な行は行番号つきで返す", () => {
    expect(parseBookingCurveCsv("stayDate,daysBefore,roomsBooked\n2025/10/1,7,40\n").rows).toEqual([
      { stayDate: "2025-10-01", daysBefore: 7, roomsBooked: 40 },
    ])
    const csv = "宿泊日,残日数,取得日,予約室数\n2025-10-01,,,10\n2025-10-01,3,2025-09-01,10\n2025-10-01,-1,,x\n2025-10-01,,2025-10-05,1\n"
    const { rows, errors } = parseBookingCurveCsv(csv)
    expect(rows).toEqual([])
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4, 5])
    expect(errors[0].message).toContain("どちらかを入力")
    expect(errors[1].message).toContain("どちらか一方だけ")
    expect(errors[2].message).toContain("残日数は0以上の整数")
    expect(errors[2].message).toContain("予約室数")
    expect(errors[3].message).toContain("取得日は宿泊日以前")
  })

  it("残日数・取得日の列がどちらも無ければ見出しのエラー", () => {
    expect(parseBookingCurveCsv("宿泊日,予約室数\n2025-10-01,1\n").errors[0].message).toContain("「残日数」か「取得日」")
  })
})

describe("parseDailyBudgetCsv（D-13）", () => {
  it("テンプレートを読め、両方空欄の行は登録を消す行（null・null）になる", () => {
    const { rows, errors } = parseDailyBudgetCsv(DAILY_BUDGET_CSV_TEMPLATE)
    expect(errors).toEqual([])
    expect(rows).toEqual([
      { date: "2026-12-01", budgetRooms: 120, budgetRevenue: 1800000 },
      { date: "2026-12-02", budgetRooms: 95, budgetRevenue: 1300000 },
      { date: "2026-12-03", budgetRooms: null, budgetRevenue: null },
    ])
  })

  it("桁区切り・片方の列だけも受け付け、重複した日付・不正な値は行番号つきで返す", () => {
    expect(parseDailyBudgetCsv('日付,予算売上\n2026/12/1,"1,500,000"\n').rows).toEqual([
      { date: "2026-12-01", budgetRooms: null, budgetRevenue: 1500000 },
    ])
    const { rows, errors } = parseDailyBudgetCsv("日付,予算室数,予算売上\n2026-12-01,10,100\n2026-12-01,11,100\n2026-12-02,1.5,-1\n12/3,1,1\n")
    expect(rows).toHaveLength(1)
    expect(errors.map((e) => e.line)).toEqual([3, 4, 5])
    expect(errors[0].message).toContain("2行目にもあります")
    expect(errors[1].message).toContain("予算室数は0以上の整数")
    expect(errors[1].message).toContain("予算売上は0以上")
    expect(errors[2].message).toContain("日付は")
  })

  it("予算室数・予算売上の列がどちらも無ければ見出しのエラー", () => {
    expect(parseDailyBudgetCsv("日付\n2026-12-01\n").errors[0].message).toContain("「予算室数」か「予算売上」")
  })
})

describe("parseReservationCsv（D-13 予約明細から作る）", () => {
  it("テンプレートを読め、取消日は入っている行だけに付く", () => {
    const { rows, errors } = parseReservationCsv(RESERVATION_CSV_TEMPLATE)
    expect(errors).toEqual([])
    expect(rows).toEqual([
      { bookedDate: "2025-07-03", checkInDate: "2025-10-01", nights: 2, rooms: 1, reservationCode: "R0001", guests: 2, revenue: 36000, channel: "楽天トラベル" },
      { bookedDate: "2025-08-20", checkInDate: "2025-10-10", nights: 1, rooms: 3, reservationCode: "R0002", guests: 6, revenue: 54000, channel: "自社サイト" },
      {
        bookedDate: "2025-09-01",
        checkInDate: "2025-10-11",
        nights: 1,
        rooms: 1,
        cancelledDate: "2025-09-15",
        reservationCode: "R0003",
        guests: 1,
        revenue: 12000,
        channel: "じゃらん",
      },
    ])
  })

  it("任意の列（人数・室料）が不正なら行のエラー。空欄は付けない", () => {
    const csv = "予約日,チェックイン日,泊数,室数,人数,室料\n2025-09-01,2025-10-01,1,1,1.5,-1\n2025-09-01,2025-10-01,1,1,,\n"
    const { rows, errors } = parseReservationCsv(csv)
    expect(errors[0].message).toContain("人数は0以上の整数")
    expect(errors[0].message).toContain("室料は0以上")
    expect(rows).toEqual([{ bookedDate: "2025-09-01", checkInDate: "2025-10-01", nights: 1, rooms: 1 }])
  })

  it("取消日の列が無くても読め、不正な行は行番号つきで返す", () => {
    expect(parseReservationCsv("bookedDate,checkInDate,nights,rooms\n2025/7/3,2025/10/1,1,2\n").rows).toEqual([
      { bookedDate: "2025-07-03", checkInDate: "2025-10-01", nights: 1, rooms: 2 },
    ])
    const csv = "予約日,チェックイン日,泊数,室数,取消日\n2025-10-05,2025-10-01,1,1,\n2025-09-01,2025-10-01,0,0,\n2025-09-01,2025-10-01,61,1,2025-08-01\nx,2025-10-01,1,1,昨日\n"
    const { rows, errors } = parseReservationCsv(csv)
    expect(rows).toEqual([])
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4, 5])
    expect(errors[0].message).toContain("予約日がチェックイン日より後")
    expect(errors[1].message).toContain("泊数は1〜60")
    expect(errors[1].message).toContain("室数は1以上")
    expect(errors[2].message).toContain("取消日が予約日より前")
    expect(errors[3].message).toContain("予約日は")
    expect(errors[3].message).toContain("取消日は")
  })

  it("必須列が無ければ見出しのエラー", () => {
    expect(parseReservationCsv("予約日,チェックイン日\n2025-07-03,2025-10-01\n").errors[0].message).toContain("泊数・室数")
  })
})
