// CSVインポート用の軽量パーサ（SAAS_ONBOARDING.md Step 3）。
// 外部依存を増やさないため自前実装。RFC 4180 相当:
// ダブルクォート囲み・"" エスケープ・CRLF/LF・先頭BOM に対応する。

interface CsvRow {
  cells: string[]
  /** 元テキスト上の物理行番号（1始まり）。空行やクォート内改行があってもExcel上の行と一致する */
  line: number
}

export interface CsvParseResult {
  header: string[]
  /** ヘッダー行を除いたデータ行。キーはヘッダー名（trim済み） */
  records: Array<{ values: Record<string, string>; line: number }>
}

function parseCsvRows(text: string): CsvRow[] {
  // Excel出力のUTF-8 BOMを除去
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  const rows: CsvRow[] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let physicalLine = 1
  let rowStartLine = 1

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
        // クォート内の改行はフィールドの一部だが、物理行としてはカウントする
        if (ch === '\n') physicalLine++
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      physicalLine++
      row.push(field)
      field = ''
      rows.push({ cells: row, line: rowStartLine })
      row = []
      rowStartLine = physicalLine
    } else {
      field += ch
    }
  }
  // 最終行（末尾改行なし）
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push({ cells: row, line: rowStartLine })
  }

  // 完全な空行は除外（物理行番号は保持したまま）
  return rows.filter((r) => r.cells.some((v) => v.trim() !== ''))
}

export function parseCsv(text: string): string[][] {
  return parseCsvRows(text).map((r) => r.cells)
}

/**
 * ヘッダー行付きCSVをレコード配列に変換する。
 * line はエラー表示用の物理行番号（元テキストの1始まり。通常ヘッダー=1行目、データは2行目〜）
 */
export function parseCsvWithHeader(text: string): CsvParseResult {
  const rows = parseCsvRows(text)
  if (rows.length === 0) return { header: [], records: [] }

  const header = rows[0].cells.map((h) => h.trim())
  const records = rows.slice(1).map((row) => {
    const values: Record<string, string> = {}
    header.forEach((name, col) => {
      values[name] = (row.cells[col] ?? '').trim()
    })
    return { values, line: row.line }
  })
  return { header, records }
}
