// CSV パーサ（現地テスト・予約明細取込用）。
//
// サイトコントローラー（TL-リンカーン等）や PMS から落とすCSVは
//   - 文字コードが Shift_JIS（CP932）のことが多い
//   - 改行が CRLF、フィールド内に改行やカンマが引用符付きで入る
//   - タブ区切りで出てくる設定もある
// という前提があるため、外部依存を足さずにこのファイルで吸収する。
//
// 取り込み対象のファイルは人の操作で持ち込まれる想定なので、
// 壊れた引用符でも例外にせず「読めたところまで」を返す方針にしている
// （現地で列名を確認する用途では、途中で止まるより全体像が見えるほうが役に立つ）。

/** Node の TextDecoder が解釈できるラベルへ寄せる（cp932 / sjis 等の別名を吸収） */
function toDecoderLabel(encoding: string): string {
  const normalized = encoding.trim().toLowerCase()
  if (['cp932', 'sjis', 'shift-jis', 'shift_jis', 'windows-31j', 'ms932'].includes(normalized)) {
    return 'shift_jis'
  }
  if (['utf8', 'utf-8'].includes(normalized)) return 'utf-8'
  return normalized
}

/**
 * ファイルの中身を文字列へデコードする。
 * @param encoding 'cp932'（既定）または 'utf8'。別名も受け付ける
 */
export function decodeCsv(buffer: Uint8Array, encoding = 'cp932'): string {
  return new TextDecoder(toDecoderLabel(encoding)).decode(buffer)
}

/**
 * CSV/TSV をセルの二次元配列へ分解する（RFC 4180 準拠 + CRLF/BOM 対応）。
 * 空行は読み飛ばす。
 */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let hasField = false

  const pushField = () => {
    row.push(field)
    field = ''
    hasField = false
  }
  const pushRow = () => {
    pushField()
    // 空行（区切りも中身も無い行）は捨てる
    if (!(row.length === 1 && row[0] === '')) rows.push(row)
    row = []
  }

  // 先頭の BOM を除去
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0

  for (; i < text.length; i++) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"' && !hasField) {
      inQuotes = true
      hasField = true
    } else if (char === delimiter) {
      pushField()
    } else if (char === '\n') {
      pushRow()
    } else if (char === '\r') {
      // CRLF は LF 側で行終端として扱う。単独 CR も行終端とみなす
      if (text[i + 1] !== '\n') pushRow()
    } else {
      field += char
      hasField = true
    }
  }

  if (field !== '' || row.length > 0) pushRow()

  return rows
}

/**
 * 1行目をヘッダーとして、各行を「列名 → 値」のレコードへ変換する。
 * 同名の列が複数ある場合は 2つ目以降に `#2` を付けて区別する
 * （TLのCSVは「料金」等の列名が重複することがあるため、黙って上書きしない）。
 */
export function toRecords(rows: string[][]): { headers: string[]; records: Record<string, string>[] } {
  if (rows.length === 0) return { headers: [], records: [] }

  const seen = new Map<string, number>()
  const headers = rows[0].map((raw, index) => {
    const name = raw.trim() || `列${index + 1}`
    const count = (seen.get(name) ?? 0) + 1
    seen.set(name, count)
    return count === 1 ? name : `${name}#${count}`
  })

  const records = rows.slice(1).map((cells) => {
    const record: Record<string, string> = {}
    headers.forEach((header, index) => {
      record[header] = (cells[index] ?? '').trim()
    })
    return record
  })

  return { headers, records }
}
