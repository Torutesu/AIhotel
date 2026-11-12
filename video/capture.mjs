#!/usr/bin/env node
// 起動中の実アプリ（frontend :3000 + backend :3001、seed 済み）を操作して、動画の素材を撮る。
//   node video/capture.mjs            全ショット
//   node video/capture.mjs pricing    id が前方一致するショットだけ（前後の操作は実行する）
// 出力: video/captures/<id>/*.png と video/captures/manifest.json
import { createRequire } from 'node:module'
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shots, VIEWPORT } from './shots.mjs'

const require = createRequire(import.meta.url)
function loadPlaywright() {
  for (const name of ['playwright', '@playwright/test']) {
    try { return require(name) } catch { /* 次を試す */ }
  }
  // リポジトリの e2e ワークスペースに入っているものを使う
  return createRequire(new URL('../e2e/package.json', import.meta.url))('@playwright/test')
}
const { chromium } = loadPlaywright()

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(here, 'captures')
const BASE = process.env.VIDEO_BASE_URL ?? 'http://localhost:3000'
const EMAIL = process.env.VIDEO_LOGIN_EMAIL ?? 'admin@demo-hotel.example.com'
const PASSWORD = process.env.VIDEO_LOGIN_PASSWORD ?? 'Admin1234'
const SCALE = 2
const TILE = 1080
const MAX_HEIGHT = 9000
const only = process.argv[2]

/** ページ内で領域の矩形を求める（scope: 'main' か 'dialog'） */
async function measure(page, spec, scope) {
  if (spec.union) {
    const rects = (await Promise.all(spec.union.map((s) => measure(page, s, scope)))).filter(Boolean)
    if (rects.length === 0) return null
    const x = Math.min(...rects.map((r) => r.x)), y = Math.min(...rects.map((r) => r.y))
    const x2 = Math.max(...rects.map((r) => r.x + r.w)), y2 = Math.max(...rects.map((r) => r.y + r.h))
    return { x, y, w: x2 - x, h: y2 - y }
  }
  const root = page.locator(spec.scope === 'page' ? 'body' : scope === 'dialog' ? '[role=dialog]' : spec.scope === 'main' ? 'main' : 'body')
  let box = null
  if (spec.block) {
    box = await root.first().evaluate((el, { text, minH, minW }) => {
      const own = (e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()
      const all = [...el.querySelectorAll('*')]
      const hit = all.find((e) => own(e).startsWith(text)) ?? all.find((e) => own(e).includes(text))
      if (!hit) return null
      let cur = hit
      for (;;) {
        const r = cur.getBoundingClientRect()
        if ((r.height >= minH && r.width >= minW) || !cur.parentElement || cur === el) break
        cur = cur.parentElement
      }
      const r = cur.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }, { text: spec.block, minH: spec.minH ?? 140, minW: spec.minW ?? 500 })
  } else {
    let loc
    if (spec.card) {
      // タイトルが一致するカード（入れ子のときは内側）
      const esc = spec.card.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      loc = page.locator('[data-slot=card]').filter({ has: page.locator('[data-slot=card-title]', { hasText: new RegExp(`^\\s*${esc}`) }) }).last()
      box = (await loc.count()) > 0 ? await loc.boundingBox() : null
      return box ? { x: box.x, y: box.y, w: box.width, h: box.height } : null
    }
    if (spec.sel) loc = page.locator(spec.sel)
    else if (spec.text) loc = root.getByText(spec.text, { exact: typeof spec.text === 'string' })
    else if (spec.role) loc = root.getByRole(spec.role[0], { name: spec.role[1], exact: typeof spec.role[1] === 'string' })
    else if (spec.row) loc = root.locator('tr', { hasText: spec.row })
    loc = loc.nth(spec.nth ?? 0)
    box = (await loc.count()) > 0 ? await loc.boundingBox() : null
  }
  return box ? { x: box.x, y: box.y, w: box.width, h: box.height } : null
}

const round = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v * 10) / 10]))

async function main() {
  await mkdir(OUT, { recursive: true })
  const manifestPath = path.join(OUT, 'manifest.json')
  let manifest = { viewport: VIEWPORT, scale: SCALE, tile: TILE, sidebarWidth: 264, shots: {} }
  if (only) { try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) } catch { /* 新規 */ } }

  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: SCALE, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', colorScheme: 'light', acceptDownloads: true,
  })
  const page = await context.newPage()
  await page.goto(BASE + '/')
  let loggedIn = false
  const missing = []

  for (const shot of shots) {
    if (!shot.beforeLogin && !loggedIn) {
      await page.getByLabel('メールアドレス').fill(EMAIL)
      await page.getByLabel('パスワード', { exact: true }).fill(PASSWORD)
      await page.getByRole('button', { name: 'ログイン' }).click()
      await page.getByRole('button', { name: 'ダッシュボード' }).waitFor()
      await page.waitForTimeout(1500)
      loggedIn = true
    }
    await page.setViewportSize(VIEWPORT)
    await page.waitForTimeout(300)
    if (shot.go) await shot.go(page)
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(1800)
    if (only && !shot.id.startsWith(only)) continue

    const dir = path.join(OUT, shot.id)
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
    const entry = { kind: shot.kind, regions: {} }
    const scope = shot.kind === 'dialog' ? 'dialog' : 'main'

    if (shot.beforeLogin) {
      // ログイン画面は入力済みの見た目で撮る
      await page.getByLabel('メールアドレス').fill(EMAIL)
      await page.getByLabel('パスワード', { exact: true }).fill(PASSWORD)
      await page.locator('body').click({ position: { x: 5, y: 5 } })
    }

    if (shot.kind === 'viewport') {
      await page.screenshot({ path: path.join(dir, 'tile-0.png') })
      entry.height = VIEWPORT.height
      entry.tiles = ['tile-0.png']
    } else if (shot.kind === 'page') {
      await page.screenshot({ path: path.join(dir, 'sidebar.png'), clip: { x: 0, y: 0, width: manifest.sidebarWidth, height: VIEWPORT.height } })
      const full = await page.evaluate(() => document.querySelector('main').scrollHeight)
      const height = Math.max(VIEWPORT.height, Math.min(MAX_HEIGHT, full))
      await page.setViewportSize({ width: VIEWPORT.width, height })
      await page.evaluate(() => { document.querySelector('main').scrollTop = 0 })
      await page.waitForTimeout(2600) // グラフの再描画アニメーションを待つ
      entry.height = height
      entry.tiles = []
      for (let y = 0, i = 0; y < height; y += TILE, i++) {
        const name = `tile-${i}.png`
        await page.screenshot({ path: path.join(dir, name), clip: { x: 0, y, width: VIEWPORT.width, height: Math.min(TILE, height - y) } })
        entry.tiles.push(name)
      }
      if (shot.pdf) {
        // 実際に出力される月次レポート（PDF）の1ページ目も素材にする
        try {
          const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 20000 }),
            page.getByRole('button', { name: 'レポートをダウンロード' }).click(),
          ])
          const pdf = path.join(dir, 'report.pdf')
          await download.saveAs(pdf)
          execFileSync('pdftoppm', ['-png', '-r', '150', '-f', '1', '-l', '1', pdf, path.join(dir, 'report')])
          entry.pdfPage = 'report-1.png'
        } catch (e) { console.warn(`  ! PDF を取得できませんでした: ${String(e).slice(0, 120)}`) }
      }
    } else if (shot.kind === 'dialog') {
      const dlg = page.locator('[role=dialog]').last()
      await dlg.waitFor()
      const info = await dlg.evaluate((d) => {
        const r = d.getBoundingClientRect()
        const sc = [...d.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 8 && /auto|scroll/.test(getComputedStyle(e).overflowY))
        return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, headerH: sc ? sc.getBoundingClientRect().top - r.top : 0, extra: sc ? sc.scrollHeight - sc.clientHeight : 0 }
      })
      const need = Math.min(MAX_HEIGHT, Math.ceil((info.rect.h + info.extra + 40) / 0.9))
      await page.setViewportSize({ width: VIEWPORT.width, height: Math.max(VIEWPORT.height, need) })
      await page.waitForTimeout(2600)
      await dlg.screenshot({ path: path.join(dir, 'dialog.png') })
      const full = await dlg.boundingBox()
      entry.dialog = { rect: round(info.rect), headerH: Math.round(info.headerH), height: Math.round(full.height) }
      entry.offset = { x: full.x, y: full.y }
    }

    for (const [name, spec] of Object.entries(shot.regions ?? {})) {
      const r = await measure(page, spec, scope)
      if (!r) { missing.push(`${shot.id}.${name}`); continue }
      if (entry.offset) { r.x -= entry.offset.x; r.y -= entry.offset.y }
      entry.regions[name] = round(r)
    }
    delete entry.offset
    manifest.shots[shot.id] = entry
    console.log(`✓ ${shot.id} (${shot.kind}, ${entry.height ?? entry.dialog?.height}px, 領域 ${Object.keys(entry.regions).length})`)
  }

  await browser.close()
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  if (missing.length > 0) {
    console.error(`見つからなかった領域: ${missing.join(', ')}`)
    process.exitCode = 1
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
