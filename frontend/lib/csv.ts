// CSV 読み込みの共通部品（#82 の日次実績から切り出し — #9 / #24 でも使う）。
// Excel で保存した CSV を想定し、BOM・CRLF・ダブルクォート（中の改行を含む）・桁区切りのカンマ・日付の / 区切りを受け付ける。
// 書き出し（lib/csv-export.ts）が数式の実行を防ぐために付けた先頭の ' は外して読む。
// 値の妥当性（範囲・既存データとの関係）はバックエンドが検証する。ここでは形式だけを見る。

export interface CsvParseError {
  /** ファイル上の行番号（1始まり。見出しが1行目） */
  line: number
  message: string
}

/** 1行をセルに分ける（ダブルクォート内のカンマと "" に対応） */
export function splitCsvLine(line: string): string[] {
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

/** 数値に直す。空欄は null、数値でなければ NaN（桁区切りのカンマ・円記号は無視） */
export function parseNumber(value: string): number | null {
  const normalized = value.replace(/[,¥￥\s]/g, "")
  if (normalized === "") return null
  const n = Number(normalized)
  return Number.isFinite(n) ? n : NaN
}

/** "2026/9/1" や "2026-09-01" を "2026-09-01" にする。形式が違えば null */
export function normalizeDate(value: string): string | null {
  const m = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (!m) return null
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`
}

/**
 * テキストを CSV の行（レコード）に分ける。ダブルクォートの中の改行は行の区切りにしない。
 * line は各レコードが始まるファイル上の行番号（1始まり）
 */
export function splitCsvRecords(text: string): Array<{ line: number; raw: string }> {
  const records: Array<{ line: number; raw: string }> = []
  let current = ""
  let quoted = false
  let line = 1
  let startLine = 1
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      quoted = !quoted
      current += ch
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++
      records.push({ line: startLine, raw: current })
      current = ""
      line++
      startLine = line
    } else {
      // クォートの中の改行は残す（CRLF は LF にそろえる）
      if (ch === "\r" && text[i + 1] === "\n") continue
      if (ch === "\n") line++
      current += ch
    }
  }
  if (current !== "") records.push({ line: startLine, raw: current })
  return records
}

/** 書き出しで数式の実行を防ぐために付けた先頭の ' を外す（' のあとが = + - @ のときだけ） */
export function unescapeCsvCell(value: string): string {
  return value.replace(/^'(?=[=+\-@])/, "")
}

/**
 * 見出し行から列の位置を引き、データ行をセルの配列で返す。
 * aliases は列ごとの見出し名（英語名は小文字で。[1] 番目の名前をエラー表示に使う）。
 * 必須列が無ければ lines は空で errors に1件入る。
 */
export function readCsvTable<K extends string>(
  text: string,
  aliases: Record<K, string[]>,
  required: Array<NoInfer<K>>
): { index: Record<K, number>; lines: Array<{ line: number; cells: string[] }>; errors: CsvParseError[] } {
  const all = splitCsvRecords(text.replace(/^﻿/, ""))
  const header = splitCsvLine(all[0]?.raw ?? "").map((h) => h.toLowerCase())
  const index = {} as Record<K, number>
  for (const key of Object.keys(aliases) as K[]) {
    index[key] = header.findIndex((h) => aliases[key].includes(h))
  }
  const missing = required.filter((key) => index[key] < 0)
  if (missing.length > 0) {
    return {
      index,
      lines: [],
      errors: [
        {
          line: 1,
          message: `見出し行に必要な列がありません（${missing.map((k) => aliases[k][1]).join("・")}）。テンプレートの見出しを使ってください`,
        },
      ],
    }
  }
  const lines = all
    .slice(1)
    .filter(({ raw }) => raw.trim() !== "")
    .map(({ line, raw }) => ({ line, cells: splitCsvLine(raw).map(unescapeCsvCell) }))
  return { index, lines, errors: lines.length === 0 ? [{ line: 1, message: "データ行がありません" }] : [] }
}
