// CSV の書き出し（外部需要動向の一覧 — 2026-10）。
// Excel で開いて文字化けしないよう UTF-8 の BOM を付け、改行は CRLF にする。
// カンマ・ダブルクォート・改行を含むセルはダブルクォートで囲む（"" でエスケープ）。
// = + - @ で始まる文字列は Excel が数式として実行しうるので、先頭に ' を付ける（CSV インジェクション対策。
// 取り込み側の lib/csv.ts が外して読む）。数値と、数値だけの文字列（"+12.4%" "-3" 等。Excel は数値として読む）はそのまま書く。

export type CsvValue = string | number | boolean | null | undefined

const FORMULA_START = /^[=+\-@]/
const PLAIN_NUMBER = /^[+-]?\d[\d,]*(\.\d+)?%?$/

export function csvCell(value: CsvValue): string {
  if (value == null) return ""
  const raw = typeof value === "boolean" ? (value ? "○" : "") : String(value)
  const text = typeof value === "string" && FORMULA_START.test(raw) && !PLAIN_NUMBER.test(raw) ? `'${raw}` : raw
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(rows: CsvValue[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n"
}

/** ブラウザでファイルとして保存させる */
export function downloadCsv(fileName: string, rows: CsvValue[][]): void {
  const blob = new Blob([`﻿${toCsv(rows)}`], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  // 文書に追加してからクリックしないと、ブラウザによってはファイル名が付かない
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** ファイル名に付ける今日の日付（例: 20261019） */
export function fileDateStamp(date = new Date()): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`
}
