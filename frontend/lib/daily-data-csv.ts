// 日次実績 CSV の読み込み（#82）。
// 1行目は見出し。列の順番は問わず、英語名（date, soldRooms, totalRevenue, guests）と
// 日本語名（日付, 販売室数, 室料売上, 宿泊人数）のどちらでもよい。

import { normalizeDate, parseNumber, readCsvTable, type CsvParseError } from "@/lib/csv"

export type { CsvParseError } from "@/lib/csv"

export interface DailyDataCsvRow {
  date: string
  soldRooms: number
  totalRevenue: number
  guests: number | null
}

export const DAILY_DATA_CSV_TEMPLATE = "日付,販売室数,室料売上,宿泊人数\n2026-09-01,80,1600000,150\n2026-09-02,65,1235000,120\n"

const COLUMN_ALIASES: Record<keyof DailyDataCsvRow, string[]> = {
  date: ["date", "日付"],
  soldRooms: ["soldrooms", "販売室数"],
  totalRevenue: ["totalrevenue", "室料売上"],
  guests: ["guests", "宿泊人数"],
}

export function parseDailyDataCsv(text: string): { rows: DailyDataCsvRow[]; errors: CsvParseError[] } {
  const table = readCsvTable(text, COLUMN_ALIASES, ["date", "soldRooms", "totalRevenue"])
  if (table.errors.length > 0) return { rows: [], errors: table.errors }

  const { index } = table
  const errors: CsvParseError[] = []
  const rows: DailyDataCsvRow[] = []
  for (const { line, cells } of table.lines) {
    const date = normalizeDate(cells[index.date] ?? "")
    const soldRooms = parseNumber(cells[index.soldRooms] ?? "")
    const totalRevenue = parseNumber(cells[index.totalRevenue] ?? "")
    const guests = index.guests >= 0 ? parseNumber(cells[index.guests] ?? "") : null

    const problems: string[] = []
    if (!date) problems.push("日付は YYYY-MM-DD または YYYY/M/D 形式で入力してください")
    if (soldRooms === null || Number.isNaN(soldRooms)) problems.push("販売室数を数値で入力してください")
    if (totalRevenue === null || Number.isNaN(totalRevenue)) problems.push("室料売上を数値で入力してください")
    if (guests !== null && Number.isNaN(guests)) problems.push("宿泊人数は数値で入力してください")
    if (problems.length > 0) {
      errors.push({ line, message: problems.join("／") })
      continue
    }
    rows.push({ date: date!, soldRooms: soldRooms!, totalRevenue: totalRevenue!, guests })
  }
  return { rows, errors }
}
