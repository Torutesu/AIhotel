import ExcelJS from 'exceljs'
import type { IngestProfile } from './ingestProfiles.js'
import { BadRequestError } from '../middlewares/errorHandler.js'

// 表形式ファイル（CSV / Excel）を「ヘッダ + 行オブジェクト」に読み解く層。
// ここではPMSごとの意味解釈は行わず、素の表として読むだけに徹する
// （意味の解釈は ingestProfiles のマッピングが担当 — docs/pms-ingest-design.md §2）。

export interface ParsedTable {
  headers: string[]
  rows: Array<Record<string, unknown>>
}

/**
 * RFC4180準拠のCSVパース（引用符内のカンマ・改行、"" によるエスケープに対応）。
 * 依存を増やさずに済ませるため自前実装。
 */
export function parseCsv(text: string): string[][] {
  // BOM除去
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
      continue
    }

    if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\r') {
      // CRLF の CR は読み飛ばす
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }

  // 末尾行（改行で終わっていない場合）
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

/** Shift_JIS等のデコード。iconv-liteは任意依存とし、無い場合は明示的にエラーにする */
async function decode(buffer: Buffer, encoding: IngestProfile['encoding']): Promise<string> {
  if (!encoding || encoding === 'utf8') return buffer.toString('utf8')

  try {
    const iconv = await import('iconv-lite')
    return iconv.default.decode(buffer, 'Shift_JIS')
  } catch {
    throw new BadRequestError(
      'Shift_JISのデコードに必要なライブラリが利用できません。UTF-8で出力したファイルを取り込んでください'
    )
  }
}

function toMatrixFromCsv(text: string): string[][] {
  return parseCsv(text)
}

async function toMatrixFromExcel(buffer: Buffer, profile: IngestProfile): Promise<unknown[][]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer)

  const sheets = workbook.worksheets
  if (sheets.length === 0) throw new BadRequestError('シートが見つかりません')

  let sheet = sheets[0]
  const selector = profile.sheet
  if (selector) {
    if (selector.name) {
      const found = sheets.find((s) => s.name === selector.name)
      if (!found) throw new BadRequestError(`シート「${selector.name}」が見つかりません`)
      sheet = found
    } else if (selector.namePattern) {
      const re = new RegExp(selector.namePattern)
      const found = sheets.find((s) => re.test(s.name))
      if (!found) {
        throw new BadRequestError(
          `パターン「${selector.namePattern}」に一致するシートが見つかりません（候補: ${sheets
            .map((s) => s.name)
            .join(', ')}）`
        )
      }
      sheet = found
    } else if (selector.index != null) {
      const found = sheets[selector.index]
      if (!found) throw new BadRequestError(`シート番号 ${selector.index} が見つかりません`)
      sheet = found
    }
  }

  const matrix: unknown[][] = []
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as unknown[]
    // exceljs の row.values は 1 始まり（先頭が undefined）
    matrix.push(values.slice(1))
  })
  return matrix
}

/** Excelのセル値を素の値へ均す（数式セル・リッチテキスト対策） */
function flattenCell(value: unknown): unknown {
  if (value == null) return null
  if (value instanceof Date) return value
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    // 数式セルは計算結果（result）を採用する
    if ('result' in obj) return flattenCell(obj.result)
    if ('text' in obj) return obj.text
    if ('richText' in obj && Array.isArray(obj.richText)) {
      return (obj.richText as Array<{ text: string }>).map((r) => r.text).join('')
    }
    if ('hyperlink' in obj && 'text' in obj) return obj.text
  }
  return value
}

/**
 * ファイルを表として読み、ヘッダ行と行オブジェクト配列にする。
 * 拡張子ではなくプロファイルの format を優先し、CSVでない場合はExcelとして扱う。
 */
export async function parseTabularFile(
  buffer: Buffer,
  profile: IngestProfile
): Promise<ParsedTable> {
  const matrix: unknown[][] =
    profile.format === 'csv'
      ? toMatrixFromCsv(await decode(buffer, profile.encoding))
      : await toMatrixFromExcel(buffer, profile)

  const headerIndex = Math.max(0, profile.headerRow - 1)
  if (matrix.length <= headerIndex) {
    throw new BadRequestError('ヘッダ行が見つかりません（ファイルが空か、headerRowの指定が不正です）')
  }

  const headers = (matrix[headerIndex] ?? []).map((h) => String(flattenCell(h) ?? '').trim())

  const rows: Array<Record<string, unknown>> = []
  for (let i = headerIndex + 1; i < matrix.length; i++) {
    const raw = matrix[i] ?? []
    // 全セル空の行はスキップ
    if (raw.every((c) => flattenCell(c) == null || String(flattenCell(c)).trim() === '')) continue

    const obj: Record<string, unknown> = {}
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c]
      if (!key) continue
      obj[key] = flattenCell(raw[c])
    }
    rows.push(obj)
  }

  return { headers: headers.filter((h) => h.length > 0), rows }
}
