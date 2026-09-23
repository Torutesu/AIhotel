// CSV 読み込みの共通部品（#82 の日次実績から切り出し — #9 / #24 でも使う）。
// Excel で保存した CSV を想定し、BOM・CRLF・ダブルクォート・桁区切りのカンマ・日付の / 区切りを受け付ける。
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
 * 見出し行から列の位置を引き、データ行をセルの配列で返す。
 * aliases は列ごとの見出し名（英語名は小文字で。[1] 番目の名前をエラー表示に使う）。
 * 必須列が無ければ lines は空で errors に1件入る。
 */
export function readCsvTable<K extends string>(
  text: string,
  aliases: Record<K, string[]>,
  required: Array<NoInfer<K>>
): { index: Record<K, number>; lines: Array<{ line: number; cells: string[] }>; errors: CsvParseError[] } {
  const all = text.replace(/^﻿/, "").split(/\r?\n/)
  const header = splitCsvLine(all[0] ?? "").map((h) => h.toLowerCase())
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
    .map((raw, i) => ({ line: i + 2, raw }))
    .filter(({ raw }) => raw.trim() !== "")
    .map(({ line, raw }) => ({ line, cells: splitCsvLine(raw) }))
  return { index, lines, errors: lines.length === 0 ? [{ line: 1, message: "データ行がありません" }] : [] }
}
