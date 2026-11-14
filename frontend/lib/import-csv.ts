// 競合価格（#9）と OTB（#24 E2）の CSV の読み込み。見出しは日本語名・英語名のどちらでもよく、列の順番は問わない。

import { normalizeDate, parseNumber, readCsvTable, type CsvParseError } from "@/lib/csv"

// ---- 競合価格（#9） ----

export type CompetitorPriceSource =
  | "rakuten" | "jalan" | "ikkyu" | "expedia" | "agoda" | "booking" | "tripcom" | "official" | "manual"

export interface CompetitorPriceCsvRow {
  competitorName: string
  date: string
  price1P: number | null
  price2P: number | null
  price3P: number | null
  soldOut: boolean
  source?: CompetitorPriceSource
  observedAt?: string
}

export const COMPETITOR_PRICE_CSV_TEMPLATE =
  "競合ホテル名,宿泊日,1名料金,2名料金,3名料金,満室,取得元,取得日時\n" +
  "ホテルA,2026-10-01,12000,18000,,,楽天トラベル,2026-09-23 03:00\n" +
  "ホテルA,2026-10-01,11800,,,,じゃらん,2026-09-23 03:05\n" +
  "ホテルB,2026-10-01,,,,満室,公式サイト,2026-09-23 03:10\n"

/** 取得元の表記（キーと日本語名の両方を受け付ける） */
const SOURCE_ALIASES: Record<CompetitorPriceSource, string[]> = {
  rakuten: ["rakuten", "楽天", "楽天トラベル"],
  jalan: ["jalan", "じゃらん"],
  ikkyu: ["ikkyu", "一休", "一休.com"],
  expedia: ["expedia", "エクスペディア"],
  agoda: ["agoda", "アゴダ"],
  booking: ["booking", "booking.com", "ブッキングドットコム"],
  tripcom: ["tripcom", "trip.com", "トリップドットコム"],
  official: ["official", "公式", "公式サイト", "公式hp"],
  manual: ["manual", "手入力", "その他"],
}

const TRUE_VALUES = ["満室", "○", "1", "true", "yes", "soldout"]

function parseSource(value: string): CompetitorPriceSource | null | undefined {
  const v = value.trim().toLowerCase()
  if (v === "") return undefined
  const found = (Object.entries(SOURCE_ALIASES) as Array<[CompetitorPriceSource, string[]]>).find(([, names]) => names.includes(v))
  return found ? found[0] : null
}

/** "2026-09-23 03:00" / "2026/9/23 3:00" / ISO 8601 を ISO に直す。時差が無ければ日本時間とみなす */
export function parseObservedAt(value: string): string | null | undefined {
  const v = value.trim()
  if (v === "") return undefined
  const m = v.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/)
  if (!m) return null
  const pad = (s: string) => s.padStart(2, "0")
  const iso = `${m[1]}-${pad(m[2])}-${pad(m[3])}T${pad(m[4])}:${m[5]}:${m[6] ?? "00"}${m[7] ?? "+09:00"}`
  return Number.isNaN(new Date(iso).getTime()) ? null : iso
}

const COMPETITOR_ALIASES = {
  competitorName: ["competitorname", "競合ホテル名"],
  date: ["date", "宿泊日"],
  price1P: ["price1p", "1名料金"],
  price2P: ["price2p", "2名料金"],
  price3P: ["price3p", "3名料金"],
  soldOut: ["soldout", "満室"],
  source: ["source", "取得元"],
  observedAt: ["observedat", "取得日時"],
}

export function parseCompetitorPriceCsv(text: string): { rows: CompetitorPriceCsvRow[]; errors: CsvParseError[] } {
  const table = readCsvTable(text, COMPETITOR_ALIASES, ["competitorName", "date", "price1P"])
  if (table.errors.length > 0) return { rows: [], errors: table.errors }

  const { index } = table
  const cell = (cells: string[], i: number) => (i >= 0 ? (cells[i] ?? "") : "")
  const errors: CsvParseError[] = []
  const rows: CompetitorPriceCsvRow[] = []
  for (const { line, cells } of table.lines) {
    const competitorName = cell(cells, index.competitorName)
    const date = normalizeDate(cell(cells, index.date))
    const prices = [index.price1P, index.price2P, index.price3P].map((i) => parseNumber(cell(cells, i)))
    const soldOut = TRUE_VALUES.includes(cell(cells, index.soldOut).toLowerCase())
    const source = parseSource(cell(cells, index.source))
    const observedAt = parseObservedAt(cell(cells, index.observedAt))

    const problems: string[] = []
    if (competitorName === "") problems.push("競合ホテル名を入力してください")
    if (!date) problems.push("宿泊日は YYYY-MM-DD または YYYY/M/D 形式で入力してください")
    if (prices.some((p) => p !== null && Number.isNaN(p))) problems.push("料金は数値で入力してください")
    if (source === null) problems.push("取得元が分かりません（楽天トラベル・じゃらん・一休・Expedia・Agoda・Booking.com・Trip.com・公式サイト）")
    if (observedAt === null) problems.push("取得日時は YYYY-MM-DD HH:MM 形式で入力してください")
    if (problems.length > 0) {
      errors.push({ line, message: problems.join("／") })
      continue
    }
    rows.push({
      competitorName,
      date: date!,
      price1P: prices[0],
      price2P: prices[1],
      price3P: prices[2],
      soldOut,
      ...(source ? { source } : {}),
      ...(observedAt ? { observedAt } : {}),
    })
  }
  return { rows, errors }
}

// ---- OTB（#24 E2） ----

export interface OtbCsvRow {
  stayDate: string
  roomsBooked: number
}

export const OTB_CSV_TEMPLATE = "宿泊日,予約室数\n2026-10-01,120\n2026-10-02,98\n"

const OTB_ALIASES = {
  stayDate: ["staydate", "宿泊日"],
  roomsBooked: ["roomsbooked", "予約室数"],
}

export function parseOtbCsv(text: string): { rows: OtbCsvRow[]; errors: CsvParseError[] } {
  const table = readCsvTable(text, OTB_ALIASES, ["stayDate", "roomsBooked"])
  if (table.errors.length > 0) return { rows: [], errors: table.errors }

  const errors: CsvParseError[] = []
  const rows: OtbCsvRow[] = []
  for (const { line, cells } of table.lines) {
    const stayDate = normalizeDate(cells[table.index.stayDate] ?? "")
    const roomsBooked = parseNumber(cells[table.index.roomsBooked] ?? "")
    const problems: string[] = []
    if (!stayDate) problems.push("宿泊日は YYYY-MM-DD または YYYY/M/D 形式で入力してください")
    if (roomsBooked === null || Number.isNaN(roomsBooked)) problems.push("予約室数を数値で入力してください")
    if (problems.length > 0) {
      errors.push({ line, message: problems.join("／") })
      continue
    }
    rows.push({ stayDate: stayDate!, roomsBooked: roomsBooked! })
  }
  return { rows, errors }
}

// ---- 過去の予約の推移（ブッキングカーブ — D-13） ----

/** 1行 = ある宿泊日の、ある時点（宿泊日の何日前、または取得日）の予約室数。残日数と取得日はどちらか一方 */
export interface BookingCurveCsvRow {
  stayDate: string
  daysBefore?: number
  capturedDate?: string
  roomsBooked: number
}

export const BOOKING_CURVE_CSV_TEMPLATE =
  "宿泊日,残日数,取得日,予約室数\n" +
  "2025-10-01,90,,32\n" +
  "2025-10-01,30,,85\n" +
  "2025-10-01,0,,128\n" +
  "2025-10-02,,2025-07-01,20\n"

const BOOKING_CURVE_ALIASES = {
  stayDate: ["staydate", "宿泊日"],
  daysBefore: ["daysbefore", "残日数"],
  capturedDate: ["captureddate", "取得日"],
  roomsBooked: ["roomsbooked", "予約室数"],
}

export function parseBookingCurveCsv(text: string): { rows: BookingCurveCsvRow[]; errors: CsvParseError[] } {
  const table = readCsvTable(text, BOOKING_CURVE_ALIASES, ["stayDate", "roomsBooked"])
  if (table.errors.length > 0) return { rows: [], errors: table.errors }
  const { index } = table
  if (index.daysBefore < 0 && index.capturedDate < 0) {
    return { rows: [], errors: [{ line: 1, message: "見出し行に「残日数」か「取得日」の列が必要です。テンプレートの見出しを使ってください" }] }
  }

  const cell = (cells: string[], i: number) => (i >= 0 ? (cells[i] ?? "") : "")
  const errors: CsvParseError[] = []
  const rows: BookingCurveCsvRow[] = []
  for (const { line, cells } of table.lines) {
    const stayDate = normalizeDate(cell(cells, index.stayDate))
    const daysBefore = parseNumber(cell(cells, index.daysBefore))
    const capturedRaw = cell(cells, index.capturedDate)
    const capturedDate = capturedRaw === "" ? null : normalizeDate(capturedRaw)
    const roomsBooked = parseNumber(cell(cells, index.roomsBooked))

    const problems: string[] = []
    if (!stayDate) problems.push("宿泊日は YYYY-MM-DD または YYYY/M/D 形式で入力してください")
    if (daysBefore !== null && (Number.isNaN(daysBefore) || !Number.isInteger(daysBefore) || daysBefore < 0)) {
      problems.push("残日数は0以上の整数で入力してください")
    }
    if (capturedRaw !== "" && !capturedDate) problems.push("取得日は YYYY-MM-DD または YYYY/M/D 形式で入力してください")
    if (daysBefore === null && capturedRaw === "") problems.push("残日数か取得日のどちらかを入力してください")
    if (daysBefore !== null && capturedRaw !== "") problems.push("残日数と取得日はどちらか一方だけを入力してください")
    if (stayDate && capturedDate && capturedDate > stayDate) problems.push("取得日は宿泊日以前にしてください")
    if (roomsBooked === null || Number.isNaN(roomsBooked) || !Number.isInteger(roomsBooked) || roomsBooked < 0) {
      problems.push("予約室数は0以上の整数で入力してください")
    }
    if (problems.length > 0) {
      errors.push({ line, message: problems.join("／") })
      continue
    }
    rows.push({
      stayDate: stayDate!,
      ...(daysBefore !== null ? { daysBefore } : { capturedDate: capturedDate! }),
      roomsBooked: roomsBooked!,
    })
  }
  return { rows, errors }
}

// ---- 日別予算（D-13） ----

/** 1行 = 1日の予算。予算室数・予算売上の両方が空欄の行は、その日の登録を消す */
export interface DailyBudgetCsvRow {
  date: string
  budgetRooms: number | null
  budgetRevenue: number | null
}

export const DAILY_BUDGET_CSV_TEMPLATE =
  "日付,予算室数,予算売上\n" + "2026-12-01,120,1800000\n" + "2026-12-02,95,1300000\n" + "2026-12-03,,\n"

const DAILY_BUDGET_ALIASES = {
  date: ["date", "日付"],
  budgetRooms: ["budgetrooms", "予算室数"],
  budgetRevenue: ["budgetrevenue", "予算売上"],
}

export function parseDailyBudgetCsv(text: string): { rows: DailyBudgetCsvRow[]; errors: CsvParseError[] } {
  const table = readCsvTable(text, DAILY_BUDGET_ALIASES, ["date"])
  if (table.errors.length > 0) return { rows: [], errors: table.errors }
  const { index } = table
  if (index.budgetRooms < 0 && index.budgetRevenue < 0) {
    return { rows: [], errors: [{ line: 1, message: "見出し行に「予算室数」か「予算売上」の列が必要です。テンプレートの見出しを使ってください" }] }
  }

  const cell = (cells: string[], i: number) => (i >= 0 ? (cells[i] ?? "") : "")
  const errors: CsvParseError[] = []
  const rows: DailyBudgetCsvRow[] = []
  const seen = new Map<string, number>()
  for (const { line, cells } of table.lines) {
    const date = normalizeDate(cell(cells, index.date))
    const rooms = parseNumber(cell(cells, index.budgetRooms))
    const revenue = parseNumber(cell(cells, index.budgetRevenue))

    const problems: string[] = []
    if (!date) problems.push("日付は YYYY-MM-DD または YYYY/M/D 形式で入力してください")
    if (rooms !== null && (Number.isNaN(rooms) || !Number.isInteger(rooms) || rooms < 0)) problems.push("予算室数は0以上の整数で入力してください")
    if (revenue !== null && (Number.isNaN(revenue) || revenue < 0)) problems.push("予算売上は0以上の数値で入力してください")
    if (date && seen.has(date)) problems.push(`同じ日付が${seen.get(date)}行目にもあります`)
    if (problems.length > 0) {
      errors.push({ line, message: problems.join("／") })
      continue
    }
    seen.set(date!, line)
    rows.push({ date: date!, budgetRooms: rooms, budgetRevenue: revenue })
  }
  return { rows, errors }
}

// ---- 予約明細（過去の予約の推移を作る推奨の方法 — D-13） ----

/** 1行 = 1件の予約。取消日のある予約は、取消日の前日までの時点だけに数える（バックエンドが作る） */
export interface ReservationCsvRow {
  bookedDate: string
  checkInDate: string
  nights: number
  rooms: number
  cancelledDate?: string
  /** 任意の列（予約動向・利用人数別の分析に使う — D-13） */
  reservationCode?: string
  guests?: number
  revenue?: number
  channel?: string
}

export const RESERVATION_CSV_TEMPLATE =
  "予約日,チェックイン日,泊数,室数,取消日,予約番号,人数,室料,チャネル\n" +
  "2025-07-03,2025-10-01,2,1,,R0001,2,36000,楽天トラベル\n" +
  "2025-08-20,2025-10-10,1,3,,R0002,6,54000,自社サイト\n" +
  "2025-09-01,2025-10-11,1,1,2025-09-15,R0003,1,12000,じゃらん\n"

const RESERVATION_ALIASES = {
  bookedDate: ["bookeddate", "予約日"],
  checkInDate: ["checkindate", "チェックイン日"],
  nights: ["nights", "泊数"],
  rooms: ["rooms", "室数"],
  cancelledDate: ["cancelleddate", "取消日"],
  reservationCode: ["reservationcode", "予約番号"],
  guests: ["guests", "人数", "宿泊人数"],
  revenue: ["revenue", "室料", "室料売上"],
  channel: ["channel", "チャネル", "販売チャネル"],
}

export function parseReservationCsv(text: string): { rows: ReservationCsvRow[]; errors: CsvParseError[] } {
  const table = readCsvTable(text, RESERVATION_ALIASES, ["bookedDate", "checkInDate", "nights", "rooms"])
  if (table.errors.length > 0) return { rows: [], errors: table.errors }
  const { index } = table
  const cell = (cells: string[], i: number) => (i >= 0 ? (cells[i] ?? "") : "")
  const errors: CsvParseError[] = []
  const rows: ReservationCsvRow[] = []
  for (const { line, cells } of table.lines) {
    const bookedDate = normalizeDate(cell(cells, index.bookedDate))
    const checkInDate = normalizeDate(cell(cells, index.checkInDate))
    const nights = parseNumber(cell(cells, index.nights))
    const rooms = parseNumber(cell(cells, index.rooms))
    const cancelledRaw = cell(cells, index.cancelledDate)
    const cancelledDate = cancelledRaw === "" ? null : normalizeDate(cancelledRaw)
    const reservationCode = cell(cells, index.reservationCode).trim()
    const guestsRaw = cell(cells, index.guests).trim()
    const guests = guestsRaw === "" ? null : parseNumber(guestsRaw)
    const revenueRaw = cell(cells, index.revenue).trim()
    const revenue = revenueRaw === "" ? null : parseNumber(revenueRaw)
    const channel = cell(cells, index.channel).trim()

    const problems: string[] = []
    if (!bookedDate) problems.push("予約日は YYYY-MM-DD または YYYY/M/D 形式で入力してください")
    if (!checkInDate) problems.push("チェックイン日は YYYY-MM-DD または YYYY/M/D 形式で入力してください")
    if (nights === null || Number.isNaN(nights) || !Number.isInteger(nights) || nights < 1 || nights > 60) {
      problems.push("泊数は1〜60の整数で入力してください")
    }
    if (rooms === null || Number.isNaN(rooms) || !Number.isInteger(rooms) || rooms < 1) problems.push("室数は1以上の整数で入力してください")
    if (cancelledRaw !== "" && !cancelledDate) problems.push("取消日は YYYY-MM-DD または YYYY/M/D 形式で入力してください")
    if (bookedDate && checkInDate && bookedDate > checkInDate) problems.push("予約日がチェックイン日より後です")
    if (bookedDate && cancelledDate && cancelledDate < bookedDate) problems.push("取消日が予約日より前です")
    if (guests !== null && (Number.isNaN(guests) || !Number.isInteger(guests) || guests < 0)) problems.push("人数は0以上の整数で入力してください")
    if (revenue !== null && (Number.isNaN(revenue) || revenue < 0)) problems.push("室料は0以上の数値で入力してください")
    if (reservationCode.length > 100) problems.push("予約番号は100文字以内で入力してください")
    if (channel.length > 100) problems.push("チャネルは100文字以内で入力してください")
    if (problems.length > 0) {
      errors.push({ line, message: problems.join("／") })
      continue
    }
    rows.push({
      bookedDate: bookedDate!,
      checkInDate: checkInDate!,
      nights: nights!,
      rooms: rooms!,
      ...(cancelledDate ? { cancelledDate } : {}),
      ...(reservationCode ? { reservationCode } : {}),
      ...(guests !== null ? { guests } : {}),
      ...(revenue !== null ? { revenue } : {}),
      ...(channel ? { channel } : {}),
    })
  }
  return { rows, errors }
}
