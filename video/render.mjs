#!/usr/bin/env node
// 絵コンテを 1 フレームずつ描いて MP4 にする。
//   node video/render.mjs                 すべての動画
//   node video/render.mjs launch          id を指定
//   node video/render.mjs launch --still 3,12.5   指定した秒の静止画だけ（確認用。out/stills/）
//   node video/render.mjs --script       字幕・ナレーション原稿を video/SCRIPT.md に書き出す
//   --no-audio  BGM を付けない   --workers 4  並列数   --fps 30
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile, rm, readdir } from 'node:fs/promises'
import { spawn, execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { synthMusic } from './audio.mjs'

const require = createRequire(import.meta.url)
function loadPlaywright() {
  for (const name of ['playwright', '@playwright/test']) {
    try { return require(name) } catch { /* 次を試す */ }
  }
  return createRequire(new URL('../e2e/package.json', import.meta.url))('@playwright/test')
}
const { chromium } = loadPlaywright()

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(here, 'out')
const args = process.argv.slice(2)
const flag = (name, def) => { const i = args.indexOf(name); return i === -1 ? def : args[i + 1] }
const has = (name) => args.includes(name)
const ids = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] ?? '').match(/^--(still|workers|fps)$/))
const WORKERS = Number(flag('--workers', 4))
const stillAt = flag('--still', null)

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' }
function serve() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const file = path.join(here, decodeURIComponent(new URL(req.url, 'http://x').pathname))
        if (!file.startsWith(here)) throw new Error('forbidden')
        const body = await readFile(file)
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
        res.end(body)
      } catch { res.writeHead(404); res.end() }
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

const srtTime = (t) => {
  const ms = Math.round(t * 1000)
  const p = (n, l = 2) => String(n).padStart(l, '0')
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`
}
const plain = (s) => s.replace(/<[^>]+>/g, '')

async function openPlayer(browser, base, id) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.error(`[${id}] ${e.message}`))
  await page.goto(`${base}/player/index.html`)
  const info = await page.evaluate((v) => window.loadVideo(v), id)
  return { page, info }
}

async function renderVideo(browser, base, id) {
  const first = await openPlayer(browser, base, id)
  const { info } = first
  const fps = Number(flag('--fps', info.fps))
  const total = Math.round(info.duration * fps)

  if (stillAt) {
    const dir = path.join(OUT, 'stills')
    await mkdir(dir, { recursive: true })
    for (const s of stillAt.split(',')) {
      await first.page.evaluate((t) => window.seek(t), Number(s))
      await first.page.screenshot({ path: path.join(dir, `${id}-${String(s).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 80 })
    }
    await first.page.close()
    console.log(`${id}: 静止画 ${stillAt}（全長 ${info.duration.toFixed(1)}s）`)
    return
  }

  console.log(`${id}: ${info.duration.toFixed(1)}s / ${total} フレーム`)
  const tmp = path.join(OUT, `.tmp-${id}`)
  await rm(tmp, { recursive: true, force: true })
  await mkdir(tmp, { recursive: true })

  const per = Math.ceil(total / WORKERS)
  let done = 0
  const started = Date.now()
  const parts = await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
    const from = w * per
    const to = Math.min(total, from + per)
    if (from >= to) return null
    const { page } = w === 0 ? first : await openPlayer(browser, base, id)
    const file = path.join(tmp, `part-${w}.mp4`)
    const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-vf', 'scale=in_range=full:out_range=tv', '-r', String(fps), file], { stdio: ['pipe', 'inherit', 'inherit'] })
    const closed = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}`)))))
    for (let f = from; f < to; f++) {
      await page.evaluate((t) => window.seek(t), f / fps)
      const buf = await page.screenshot({ type: 'jpeg', quality: 96 })
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r))
      done++
      if (done % 150 === 0) process.stdout.write(`\r  ${id}: ${done}/${total} (${Math.round(done / ((Date.now() - started) / 1000))} fps)   `)
    }
    ff.stdin.end()
    await closed
    await page.close()
    return file
  }))
  process.stdout.write('\n')

  const list = path.join(tmp, 'list.txt')
  await writeFile(list, parts.filter(Boolean).map((p) => `file '${p}'`).join('\n'))
  const silent = path.join(tmp, 'video.mp4')
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent])
  const out = path.join(OUT, `${id}.mp4`)
  if (has('--no-audio')) {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', silent, '-c', 'copy', '-movflags', '+faststart', out])
  } else {
    const wav = path.join(tmp, 'music.wav')
    await writeFile(wav, synthMusic(info.duration, { seed: id }))
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', silent, '-i', wav, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', out])
  }

  // 字幕（SRT）とサムネイル
  const srt = info.cues.filter((c) => c.text).map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${plain(c.text)}\n`).join('\n')
  await writeFile(path.join(OUT, `${id}.srt`), srt)
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', String(info.poster), '-i', out, '-frames:v', '1', '-q:v', '3', path.join(OUT, `${id}.jpg`)])
  await rm(tmp, { recursive: true, force: true })
  console.log(`  → ${path.relative(process.cwd(), out)}`)
  return { id, title: info.title, duration: info.duration, cues: info.cues }
}

const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

/** 全動画の字幕とナレーション原稿を video/SCRIPT.md に書き出す */
async function writeScript(browser, base, targets) {
  let md = '# 動画の台本（字幕・ナレーション原稿）\n\n`node video/render.mjs --script` が絵コンテ（`video/storyboards/`）から生成する。手で編集しない。\n\n'
    + '動画には字幕を焼き込んである。ナレーションを収録する場合は「ナレーション」の列を読む（空欄は字幕と同じ文面）。\n'
  for (const id of targets) {
    const { page, info } = await openPlayer(browser, base, id)
    await page.close()
    md += `\n## ${info.kicker ?? ''} ${info.title}（\`${id}.mp4\`・${Math.round(info.duration)}秒）\n\n| 時間 | 字幕 | ナレーション |\n|---|---|---|\n`
    for (const c of info.cues) md += `| ${clock(c.start)}–${clock(c.end)} | ${plain(c.text) || '（字幕なし）'} | ${c.narration ?? ''} |\n`
  }
  await writeFile(path.join(here, 'SCRIPT.md'), md)
  console.log('→ video/SCRIPT.md')
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const all = (await readdir(path.join(here, 'storyboards'))).filter((f) => f.endsWith('.js') && !f.startsWith('_')).map((f) => f.slice(0, -3)).sort()
  const targets = ids.length > 0 ? ids : all
  const server = await serve()
  const base = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch()
  try {
    if (has('--script')) await writeScript(browser, base, targets)
    else for (const id of targets) await renderVideo(browser, base, id)
  } finally {
    await browser.close()
    server.close()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
