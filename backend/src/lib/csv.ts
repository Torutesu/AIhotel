// CSVインポート用の軽量パーサ（SAAS_ONBOARDING.md Step 3）。
// 外部依存を増やさないため自前実装。RFC 4180 相当:
// ダブルクォート囲み・"" エスケープ・CRLF/LF・先頭BOM に対応する。

export interface CsvParseResult {
  header: string[]
  /** ヘッダー行を除いたデータ行。キーはヘッダー名（trim済み） */
  records: Array<{ values: Record<string, string>; line: number }>
}

export function parseCsv(text: string): string[][] {
  // Excel出力のUTF-8 BOMを除去
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  // 最終行（末尾改行なし）
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  // 完全な空行は除外
  return rows.filter((r) => r.some((v) => v.trim() !== ''))
}

/**
 * ヘッダー行付きCSVをレコード配列に変換する。
 * line はエラー表示用の元CSV上の行番号（ヘッダー=1行目、データは2行目〜）
 */
export function parseCsvWithHeader(text: string): CsvParseResult {
  const rows = parseCsv(text)
  if (rows.length === 0) return { header: [], records: [] }

  const header = rows[0].map((h) => h.trim())
  const records = rows.slice(1).map((cells, index) => {
    const values: Record<string, string> = {}
    header.forEach((name, col) => {
      values[name] = (cells[col] ?? '').trim()
    })
    return { values, line: index + 2 }
  })
  return { header, records }
}
