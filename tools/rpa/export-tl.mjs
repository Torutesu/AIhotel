// TL-リンカーンから予約明細CSVを取得する（現地端末で実行する — #6）。
//
// IP制限があるためホテルの端末・ネットワークから動かす前提。USBの携帯版キット
// （tools/rpa/Setup-PortablePlaywright.ps1 で作る）の中で動くので、端末には何もインストールしない。
//
// セレクタは selectors.json から読む。現地で codegen を回して実物に置き換える運用。
// 画面は毎月変わりうるので、コードを直さずJSONだけで追従できる形にしてある。
//
//   codegen.cmd https://<TLのURL>     操作を記録してセレクタを拾う
//   run.cmd                            取得を実行（out\ にCSV）
//   run.cmd --days 45 --headed         期間を変える / 画面を見ながら動かす
//
// 終了コード: 0=成功 / 1=失敗（呼び出し側が再試行を判断できるようにする）

import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, 'out')

// playwright の読み込みは設定と認証情報の確認より後に行う。
// キット未作成の端末で実行したときに「playwright が無い」より先に
// 「TL_USER が無い」「selectors.json が空」を知らせたいため。
async function loadChromium() {
  try {
    return (await import('playwright')).chromium
  } catch {
    throw new Error(
      'playwright が見つかりません。Setup-PortablePlaywright.ps1 で作ったキットの中から run.cmd で実行してください'
    )
  }
}

function parseArgs(argv) {
  const get = (name, fallback) => {
    const index = argv.indexOf(`--${name}`)
    return index >= 0 ? argv[index + 1] : fallback
  }
  return {
    days: Number(get('days', 30)),
    headed: argv.includes('--headed'),
    // 認証情報はコードに書かない。環境変数で渡す
    user: process.env.TL_USER ?? '',
    password: process.env.TL_PASSWORD ?? '',
    timeout: Number(get('timeout', 60_000)),
  }
}

/** 日付を画面の書式に合わせる（既定 yyyy/MM/dd） */
export function formatDate(date, pattern) {
  const pad = (n) => String(n).padStart(2, '0')
  return pattern
    .replace('yyyy', String(date.getFullYear()))
    .replace('MM', pad(date.getMonth() + 1))
    .replace('dd', pad(date.getDate()))
}

function timestamp() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

/** 空欄のまま実行して「何も起きない」を避けるため、必要な項目が埋まっているか先に確かめる */
export function assertConfigured(selectors) {
  const missing = []
  if (!selectors.loginUrl) missing.push('loginUrl')
  for (const key of ['userInput', 'passwordInput', 'submitButton']) {
    if (!selectors.login?.[key]) missing.push(`login.${key}`)
  }
  if (!selectors.export?.exportButton) missing.push('export.exportButton')
  if (missing.length > 0) {
    throw new Error(
      `selectors.json が未設定です（${missing.join(', ')}）。codegen.cmd で操作を記録してから埋めてください`
    )
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options.user || !options.password) {
    throw new Error('環境変数 TL_USER / TL_PASSWORD を設定してください（スクリプトに書かない）')
  }

  const selectors = JSON.parse(await readFile(join(here, 'selectors.json'), 'utf8'))
  assertConfigured(selectors)
  await mkdir(outDir, { recursive: true })

  const chromium = await loadChromium()
  const browser = await chromium.launch({ headless: !options.headed })
  const context = await browser.newContext({ acceptDownloads: true })
  context.setDefaultTimeout(options.timeout)
  // 失敗時に何が起きていたか分かるよう、最初からtraceを取る
  await context.tracing.start({ screenshots: true, snapshots: true })
  const page = await context.newPage()

  try {
    // --- ログイン ---
    await page.goto(selectors.loginUrl, { waitUntil: 'domcontentloaded' })
    await page.fill(selectors.login.userInput, options.user)
    await page.fill(selectors.login.passwordInput, options.password)
    await page.click(selectors.login.submitButton)
    if (selectors.login.successLocator) {
      // ログイン失敗を「画面が出ない」ではなく明確な失敗として扱う
      await page.waitForSelector(selectors.login.successLocator)
    }

    // --- 予約検索画面へ（クリック経路を配列で持つ） ---
    for (const step of selectors.export.navigation ?? []) {
      await page.click(step)
    }

    // --- 期間指定（既定は当日から遡ってN日） ---
    const to = new Date()
    const from = new Date(to.getTime() - options.days * 86_400_000)
    const pattern = selectors.export.dateFormat ?? 'yyyy/MM/dd'
    if (selectors.export.dateFromInput) {
      await page.fill(selectors.export.dateFromInput, formatDate(from, pattern))
    }
    if (selectors.export.dateToInput) {
      await page.fill(selectors.export.dateToInput, formatDate(to, pattern))
    }
    if (selectors.export.searchButton) {
      await page.click(selectors.export.searchButton)
    }

    // --- CSVダウンロード（固定の待ち時間は使わず、ダウンロード完了を待つ） ---
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click(selectors.export.exportButton),
    ])
    if (selectors.export.confirmButton) {
      await page.click(selectors.export.confirmButton).catch(() => {})
    }

    const csvPath = join(outDir, `tl_export_${timestamp()}.csv`)
    await download.saveAs(csvPath)

    // --- 落ちたファイルを検証する（空ファイル・エラーページを取込に流さない） ---
    const { size } = await stat(csvPath)
    if (size === 0) throw new Error('ダウンロードしたCSVが空です')

    // 文字コードは Shift_JIS 想定。ヘッダー行の確認だけこちらで行う
    const head = new TextDecoder('shift_jis').decode((await readFile(csvPath)).subarray(0, 4096))
    const headerLine = head.split(/\r?\n/)[0] ?? ''
    const columns = headerLine.split(',').length
    const minColumns = selectors.expected?.minColumns ?? 2
    if (columns < minColumns) {
      throw new Error(`列数が想定より少ないです（${columns} < ${minColumns}）。画面が変わった可能性があります`)
    }
    for (const required of selectors.expected?.requiredHeaders ?? []) {
      if (!headerLine.includes(required)) {
        throw new Error(`必要な列が見つかりません: ${required}（画面変更の可能性）`)
      }
    }

    console.log(JSON.stringify({ status: 'success', file: csvPath, bytes: size, columns }))
    await context.tracing.stop({ path: join(outDir, 'last-success-trace.zip') })
    return csvPath
  } catch (error) {
    // 現地で原因を追えるように、失敗時はスクリーンショットとtraceを残す
    await page.screenshot({ path: join(outDir, `error_${timestamp()}.png`), fullPage: true }).catch(() => {})
    await context.tracing.stop({ path: join(outDir, `error-trace_${timestamp()}.zip`) }).catch(() => {})
    await writeFile(
      join(outDir, 'last-error.txt'),
      `${new Date().toISOString()}\n${error instanceof Error ? error.stack : String(error)}\n`,
      'utf8'
    )
    throw error
  } finally {
    await context.close()
    await browser.close()
  }
}

// import されたときは実行しない（純粋関数だけ使えるようにする）
if (process.argv[1] && process.argv[1].endsWith('export-tl.mjs')) {
  main().catch((error) => {
    console.error(
      JSON.stringify({ status: 'failed', error: error instanceof Error ? error.message : String(error) })
    )
    process.exitCode = 1
  })
}
