#!/usr/bin/env node
// 内閣府「国民の祝日」CSV（https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv、Shift_JIS）から、
// バックエンドとフロントエンドが同梱する祝日の一覧を作り直す（D-13）。
// 内閣府は例年2月ごろに翌年分を公開する。公開後に一度これを流してコミットする。
// 本番は日次の外部要因ジョブ（job external-signals）が同じ CSV をストレージに保存し、同梱分より新しい年を足して使う。
//
//   node scripts/update-jp-holidays.mjs            # 内閣府から取得
//   node scripts/update-jp-holidays.mjs path.csv   # 手元のファイルから
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const SOURCE_URL = 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv'
const FROM_YEAR = 2015
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const input = process.argv[2]
const bytes = input ? await readFile(input) : Buffer.from(await (await fetch(SOURCE_URL)).arrayBuffer())
const text = new TextDecoder('shift_jis').decode(bytes)

const entries = []
for (const line of text.split(/\r?\n/).slice(1)) {
  const m = line.trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2}),(.+)$/)
  if (!m) continue
  const [, y, mo, d, name] = m
  if (Number(y) < FROM_YEAR) continue
  entries.push([`${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`, name.trim()])
}
if (entries.length < 100) throw new Error(`祝日の行が少なすぎます（${entries.length} 件）。CSV の形式を確かめてください`)
entries.sort((a, b) => a[0].localeCompare(b[0]))
const lastYear = entries[entries.length - 1][0].slice(0, 4)

const body = (quote) =>
  entries.map(([date, name]) => `  ${quote}${date}${quote}: ${quote}${name}${quote},`).join('\n')
const header = `// このファイルは scripts/update-jp-holidays.mjs が内閣府「国民の祝日」CSV から作る。手で直さない（D-13）。
// ${FROM_YEAR}〜${lastYear} 年。振替休日・国民の休日を含む。`

await writeFile(
  path.join(root, 'backend/src/lib/jpHolidaysData.ts'),
  `${header}\nexport const JP_HOLIDAYS_LAST_YEAR = ${lastYear}\nexport const JP_HOLIDAYS: Record<string, string> = {\n${body("'")}\n}\n`
)
await writeFile(
  path.join(root, 'frontend/lib/jp-holidays-data.ts'),
  `${header}\nexport const JP_HOLIDAYS_LAST_YEAR = ${lastYear}\nexport const JP_HOLIDAYS: Record<string, string> = {\n${body('"')}\n}\n`
)
console.log(`${entries.length} 件（${FROM_YEAR}〜${lastYear}）を書き出しました`)
