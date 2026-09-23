// 日次実績 CSV の読み込み（#82）。
// 1行目は見出し。列の順番は問わず、英語名（date, soldRooms, totalRevenue, guests）と
// 日本語名（日付, 販売室数, 室料売上, 宿泊人数）のどちらでもよい。
// Excel で保存した CSV を想定し、BOM・CRLF・ダブルクォート・桁区切りのカンマ・日付の / 区切りを受け付ける。
// 値の妥当性（範囲・客室数との関係）はバックエンドが検証する。ここでは形式だけを見る。

export interface DailyDataCsvRow {
  date: string
  soldRooms: number
  totalRevenue: number
  guests: number | null
}

export interface CsvParseError {
  /** ファイル上の行番号（1始まり。見出しが1行目） */
  line: number
  message: string
}

export const DAILY_DATA_CSV_TEMPLATE = "日付,販売室数,室料売上,宿泊人数\n2026-09-01,80,1600000,150\n2026-09-02,65,1235000,120\n"

const COLUMN_ALIASES: Record<keyof DailyDataCsvRow, string[]> = {
  date: ["date", "日付"],
  soldRooms: ["soldrooms", "販売室数"],
  totalRevenue: ["totalrevenue", "室料売上"],
  guests: ["guests", "宿泊人数"],
}

/** 1行をセルに分ける（ダブルクォート内のカンマと "" に対応） */
function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ""
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"'
        i++
      } else if (ch === '"') {
        quoted = false
      } else {
        current += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ",") {
      cells.push(current)
      current = ""
    } else {
      current += ch
    }
  }
  cells.push(current)
  return cells.map((c) => c.trim())
}

function parseNumber(value: string): number | null {
  const normalized = value.replace(/[,¥￥\s]/g, "")
  if (normalized === "") return null
  const n = Number(normalized)
  return Number.isFinite(n) ? n : NaN
}

/** "2026/9/1" や "2026-09-01" を "2026-09-01" にする。形式が違えば null */
function normalizeDate(value: string): string | null {
  const m = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (!m) return null
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`
}

export function parseDailyDataCsv(text: string): { rows: DailyDataCsvRow[]; errors: CsvParseError[] } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/)
  const errors: CsvParseError[] = []
  const rows: DailyDataCsvRow[] = []

  const header = splitCsvLine(lines[0] ?? "").map((h) => h.toLowerCase())
  const index = {} as Record<keyof DailyDataCsvRow, number>
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES) as Array<[keyof DailyDataCsvRow, string[]]>) {
    index[key] = header.findIndex((h) => aliases.includes(h))
  }
  const missing = (["date", "soldRooms", "totalRevenue"] as const).filter((key) => index[key] < 0)
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [
        {
          line: 1,
          message: `見出し行に必要な列がありません（${missing.map((k) => COLUMN_ALIASES[k][1]).join("・")}）。テンプレートの見出しを使ってください`,
        },
      ],
    }
  }

  lines.slice(1).forEach((raw, i) => {
    const line = i + 2
    if (raw.trim() === "") return
    const cells = splitCsvLine(raw)
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
      return
    }
    rows.push({ date: date!, soldRooms: soldRooms!, totalRevenue: totalRevenue!, guests })
  })

  if (rows.length === 0 && errors.length === 0) {
    errors.push({ line: 1, message: "データ行がありません" })
  }
  return { rows, errors }
}
