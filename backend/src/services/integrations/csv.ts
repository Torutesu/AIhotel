// 取り込み用の小さな CSV パーサ（ヘッダ行必須、カンマ区切り、ダブルクォート対応、BOM 除去）。
// 依存を増やさないための最小実装。Excel 出力の CSV（Shift_JIS）は呼び出し側で UTF-8 に変換すること
export function parseCsv(text: string): Array<Record<string, string>> {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else field += c
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  const nonEmpty = rows.filter((r) => r.some((v) => v.trim() !== ''))
  if (nonEmpty.length === 0) return []
  const header = nonEmpty[0].map((h) => h.trim())
  return nonEmpty.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])))
}
