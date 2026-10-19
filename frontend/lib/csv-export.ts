// CSV の書き出し（外部需要動向の一覧 — 2026-10）。
// Excel で開いて文字化けしないよう UTF-8 の BOM を付け、改行は CRLF にする。
// カンマ・ダブルクォート・改行を含むセルはダブルクォートで囲む（"" でエスケープ）。

export type CsvValue = string | number | boolean | null | undefined

export function csvCell(value: CsvValue): string {
  if (value == null) return ""
  const text = typeof value === "boolean" ? (value ? "○" : "") : String(value)
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
