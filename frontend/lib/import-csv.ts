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
