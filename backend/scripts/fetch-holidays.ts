// 内閣府「国民の祝日」CSV を取得し、src/data/jpHolidays.ts を再生成する。
//
//   pnpm --filter backend holidays:update
//
// 取得元: https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv
//   - 文字コード Shift_JIS、ヘッダ1行、"YYYY/M/D,名称" 形式
//   - 内閣府が毎年2月ごろに翌年分を追加する（年1回の再実行で足りる）
//   - 振替休日・国民の休日も含まれる
// 祝日はテナント非依存の参照データなので DB に入れず、生成したTSをビルドに同梱する
// （docs/外部要因設計.md §3.1）。
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const SOURCE_URL = 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv'
const MIN_YEAR = 2015 // 前年比較・バックテストに必要な範囲だけ同梱する

async function main() {
  const res = await fetch(SOURCE_URL)
  if (!res.ok) throw new Error(`祝日CSVの取得に失敗しました: HTTP ${res.status}`)
  const buf = await res.arrayBuffer()
  // Node 22 は full-icu 同梱のため shift_jis デコードが標準で使える
  const text = new TextDecoder('shift_jis').decode(buf)

  const rows: Array<{ date: string; name: string }> = []
  for (const line of text.split(/\r?\n/).slice(1)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const [rawDate, rawName] = trimmed.split(',')
    const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(rawDate ?? '')
    if (!m || !rawName) throw new Error(`解釈できない行があります: ${trimmed}`)
    const year = Number(m[1])
    if (year < MIN_YEAR) continue
    const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
    rows.push({ date, name: rawName.trim() })
  }
  rows.sort((a, b) => a.date.localeCompare(b.date))
  if (rows.length === 0) throw new Error('祝日データが空です')

  const lastYear = rows[rows.length - 1].date.slice(0, 4)
  const body = rows.map((r) => `  ['${r.date}', '${r.name.replace(/'/g, "\\'")}'],`).join('\n')
  const out = `// 自動生成ファイル — 手で編集しない。再生成: pnpm --filter backend holidays:update
// 取得元: ${SOURCE_URL}（内閣府「国民の祝日」CSV、Shift_JIS）
// 生成日: ${new Date().toISOString().slice(0, 10)} / 収録範囲: ${MIN_YEAR}〜${lastYear}
// 内閣府は毎年2月ごろに翌年分を公開するため、年1回の再生成で追従できる。

/** 収録されている最後の年。これより先の日付は祝日判定が「不明」になる（未収録＝平日扱いにしない） */
export const JP_HOLIDAYS_LAST_YEAR = ${lastYear}

/** [YYYY-MM-DD, 名称] のタプル配列（振替休日・国民の休日を含む） */
export const JP_HOLIDAYS: ReadonlyArray<readonly [string, string]> = [
${body}
]
`
  const target = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/jpHolidays.ts')
  writeFileSync(target, out, 'utf8')
  console.log(`✅ ${rows.length}件の祝日を ${target} に書き出しました（${MIN_YEAR}〜${lastYear}）`)
}

main().catch((err) => {
  console.error('❌', err)
  process.exit(1)
})
