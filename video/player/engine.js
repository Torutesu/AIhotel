// 動画の構成エンジン。絵コンテ（storyboards/*.js）と撮影素材（captures/）から、
// 時刻 t の画面を決定的に描く。CSS アニメーションは使わず、すべて seek(t) で計算する
// （render.mjs が 1 フレームずつ seek → スクリーンショットする）。

const AW = 1440 // アプリの表示幅（撮影時のビューポート）
const AH = 810
const BAR = 36 // ウィンドウのタイトルバー
const STAGE_W = 1920
const STAGE_H = 1080

const $ = (sel, root = document) => root.querySelector(sel)
const el = (tag, cls, html) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html != null) e.innerHTML = html
  return e
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const lerp = (a, b, p) => a + (b - a) * p
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1) // t が a→b を進む割合
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
const easeOut = (p) => 1 - Math.pow(1 - p, 3)
const easeOutExpo = (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p))
const easeOutBack = (p) => 1 + 2.2 * Math.pow(p - 1, 3) + 1.2 * Math.pow(p - 1, 2)

const LOGO_SVG = `<svg viewBox="0 0 32 32"><path d="M9 23.5V8.5h5.5a3.75 3.75 0 0 1 0 7.5H9M13.5 16l5 7.5" stroke="#111" stroke-width="2.6" stroke-linecap="square" fill="none"/><circle cx="23" cy="10.5" r="2.2" fill="#2f6bff"/></svg>`
const CURSOR_SVG = `<svg viewBox="0 0 24 24"><path d="M4 3l15 8.2-6.6 1.7L9.6 20 4 3z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`

let manifest = null
let video = null
let timeline = [] // { clip, start, end, node, render }
let duration = 0
const app = {}

// ---------------------------------------------------------------- 素材

async function loadImage(src) {
  const img = new Image()
  img.src = src
  await img.decode()
  return img
}

function shotInfo(id) {
  const s = manifest.shots[id]
  if (!s) throw new Error(`ショット ${id} が captures/manifest.json にありません（node video/capture.mjs を実行）`)
  return s
}

/** 'name' はページの領域、'dlg:name' は開いているダイアログの領域 */
function region(shotId, name) {
  const r = shotInfo(shotId).regions[name]
  if (!r) throw new Error(`領域 ${shotId}.${name} がありません`)
  return r
}

// ---------------------------------------------------------------- アプリのウィンドウ

async function buildApp(usedShots) {
  const root = $('#app')
  root.innerHTML = ''
  const win = el('div', 'win')
  win.append(el('div', 'win-bar', '<i></i><i></i><i></i><span class="url">レブスト — Revenue Stream</span>'))
  const vp = el('div', 'vp')
  const world = el('div', 'world')
  world.style.cssText = `position:absolute;left:0;top:0;width:${AW}px;height:${AH}px;transform-origin:0 0;will-change:transform`
  vp.append(world)
  win.append(vp)
  root.append(win)
  Object.assign(app, { root, win, vp, world, shots: {}, dialogs: {}, papers: {} })

  const jobs = []
  for (const id of usedShots) {
    const info = shotInfo(id)
    if (info.kind === 'dialog') {
      const d = el('div', 'dlg')
      const body = el('div', 'body')
      const head = el('div', 'head')
      head.style.height = `${info.dialog.headerH}px`
      d.append(body, head)
      d.style.cssText += `left:${info.dialog.rect.x}px;top:${info.dialog.rect.y}px;width:${info.dialog.rect.w}px;height:${info.dialog.rect.h}px;`
      app.dialogs[id] = { node: d, body, info }
      jobs.push(loadImage(`../captures/${id}/dialog.png`).then((img) => { body.append(img); head.append(img.cloneNode()) }))
    } else {
      const s = el('div', 'shot')
      const content = el('div', 'content')
      s.append(content)
      app.shots[id] = { node: s, content, info }
      const imgs = info.tiles.map((t) => loadImage(`../captures/${id}/${t}`))
      jobs.push(Promise.all(imgs).then((list) => content.append(...list)))
      if (info.kind === 'page') {
        jobs.push(loadImage(`../captures/${id}/sidebar.png`).then((img) => { img.className = 'sidebar'; s.append(img) }))
      }
      if (info.pdfPage) {
        const p = el('div', 'paper', '<span class="badge">実際に出力された PDF（1ページ目）</span>')
        app.papers[id] = { node: p }
        jobs.push(loadImage(`../captures/${id}/${info.pdfPage}`).then((img) => { p.append(img); app.papers[id].ratio = img.naturalHeight / img.naturalWidth }))
      }
    }
  }
  await Promise.all(jobs)
  for (const s of Object.values(app.shots)) world.append(s.node)
  app.dim = el('div', 'dim')
  world.append(app.dim)
  for (const d of Object.values(app.dialogs)) world.append(d.node)
  for (const p of Object.values(app.papers)) world.append(p.node)
  app.spot = el('div', 'spot', '<span class="lbl"></span>')
  app.spotLbl = $('.lbl', app.spot)
  app.cursor = el('div', 'cursor', `<div class="ripple"></div>${CURSOR_SVG}`)
  world.append(app.spot, app.cursor)
}

// 既定のカメラ（ウィンドウ全体が見える）
const FULL = { sx: 960, sy: 508, z: 1.03, rx: 0, ry: 0, cx: AW / 2, cy: AH / 2, iz: 1 }
// サイドにコピーを置くレイアウト（ローンチ動画）
const SIDE = { sx: 1280, sy: 520, z: 0.8, rx: 0, ry: 0 }

/** ビートの記述から、落ち着いたあとの状態（カメラ・スクロール・ハイライトなど）を求める */
function resolveBeat(beat, prev) {
  const shot = beat.shot ?? prev?.shot
  if (!shot) throw new Error('最初のビートには shot が必要です')
  const info = shotInfo(shot)
  const dialog = beat.dialog === undefined ? (prev?.shot === shot ? prev.dialog : null) : beat.dialog
  const dinfo = dialog ? shotInfo(dialog).dialog : null
  const side = beat.side === undefined ? (prev?.side ?? null) : beat.side
  const inner = !!side || beat.inner
  const st = { shot, dialog, side, paper: beat.paper ?? false }

  // 対象の領域（ビューポート座標に直す前）
  const spec = typeof beat.focus === 'string' || beat.focus == null ? { region: beat.focus } : beat.focus
  const name = spec.region
  let scroll = prev?.shot === shot ? prev.scroll : 0
  let dscroll = prev?.dialog === dialog ? prev.dscroll ?? 0 : 0
  let rect = null // ビューポート座標

  const toViewport = (regionName) => {
    if (regionName.startsWith('dlg:')) {
      const r = region(dialog, regionName.slice(4))
      const bodyH = dinfo.rect.h - dinfo.headerH
      if (r.y >= dinfo.headerH) {
        const want = r.h <= bodyH - 24 ? r.y - dinfo.headerH - (bodyH - r.h) / 2 : r.y - dinfo.headerH - 14
        dscroll = clamp(want + (spec.pan ?? 0), 0, dinfo.height - dinfo.rect.h)
      }
      const y = dinfo.rect.y + r.y - (r.y >= dinfo.headerH ? dscroll : 0)
      const top = Math.max(y, dinfo.rect.y + (r.y >= dinfo.headerH ? dinfo.headerH : 0))
      const bottom = Math.min(y + r.h, dinfo.rect.y + dinfo.rect.h)
      return { x: dinfo.rect.x + r.x, y: top, w: r.w, h: bottom - top }
    }
    const r = { ...region(shot, regionName) }
    r.w = Math.min(r.w, AW - r.x - 12)
    if (info.kind === 'page') {
      const want = r.h <= AH - 110 ? r.y + r.h / 2 - AH / 2 : r.y - 28
      scroll = clamp(want + (spec.pan ?? 0), 0, Math.max(0, info.height - AH))
    }
    const y = r.y - scroll
    const top = Math.max(y, 0)
    const bottom = Math.min(y + r.h, AH)
    return { x: r.x, y: top, w: r.w, h: Math.max(40, bottom - top) }
  }

  if (name === 'dialog' && dinfo) rect = { ...dinfo.rect }
  else if (name && name !== 'full') rect = toViewport(name)
  if (beat.scroll != null) scroll = clamp(beat.scroll, 0, Math.max(0, info.height - AH))
  if (beat.dscroll != null && dinfo) dscroll = clamp(beat.dscroll, 0, dinfo.height - dinfo.rect.h)

  // カメラ
  const cam = { ...FULL }
  if (side) Object.assign(cam, SIDE)
  if (beat.tilt) { cam.rx = beat.tilt.rx ?? 0; cam.ry = beat.tilt.ry ?? 0; cam.z = beat.tilt.z ?? cam.z }
  if (rect && spec.zoom !== 'full') {
    const pad = spec.pad ?? 26
    const w = rect.w + pad * 2
    const h = rect.h + pad * 2
    const tall = rect.h > AH - 130 // 画面より縦に長い領域は、幅に合わせて上端から見せる
    if (inner) {
      // ウィンドウは動かさず、中身だけを寄せる
      const iz = clamp(spec.zoom ?? (tall ? AW / w : Math.min(AW / w, AH / h)), 1, spec.maxZoom ?? 2.1)
      cam.iz = iz
      cam.cx = clamp(rect.x + rect.w / 2, AW / 2 / iz, AW - AW / 2 / iz)
      cam.cy = clamp(tall ? rect.y - 14 + AH / 2 / iz : rect.y + rect.h / 2, AH / 2 / iz, AH - AH / 2 / iz)
    } else {
      const z = clamp(spec.zoom ?? (tall ? 1640 / w : Math.min(1640 / w, 830 / h)), FULL.z, spec.maxZoom ?? 1.85)
      cam.z = z
      // ステージの外に余白が出ないよう、寄せる位置を制限する
      const hx = STAGE_W / 2 / z
      cam.cx = AW * z <= STAGE_W - 120 ? AW / 2 : clamp(rect.x + rect.w / 2, hx - 70 / z, AW - hx + 70 / z)
      const winH = AH + BAR
      const cyWin = (tall ? rect.y - 20 + 430 / z : rect.y + rect.h / 2) + BAR
      const top = cam.sy / z - 36 / z
      const bottom = winH - (STAGE_H - cam.sy) / z + 150 / z
      cam.cy = (winH * z <= STAGE_H - 140 ? winH / 2 : clamp(cyWin, Math.min(top, bottom), Math.max(top, bottom))) - BAR
    }
  }
  st.cam = cam
  st.scroll = scroll
  st.dscroll = dscroll

  // ハイライト
  const hlName = beat.highlight === true ? name : beat.highlight
  st.hl = hlName ? { ...toViewportStatic(hlName, shot, dialog, scroll, dscroll), label: beat.label ?? '' } : null
  // カーソル
  if (beat.cursor) {
    const r = toViewportStatic(beat.cursor, shot, dialog, scroll, dscroll)
    st.cursor = { x: r.x + r.w * (beat.cursorAt?.[0] ?? 0.5), y: r.y + r.h * (beat.cursorAt?.[1] ?? 0.5) }
  } else st.cursor = null
  st.cursorPos = st.cursor ?? prev?.cursorPos ?? { x: 980, y: 560 }
  return st
}

/** スクロールを動かさずに、いまの状態での領域の位置を返す */
function toViewportStatic(regionName, shot, dialog, scroll, dscroll) {
  if (regionName.startsWith('dlg:')) {
    const d = shotInfo(dialog).dialog
    const r = region(dialog, regionName.slice(4))
    const inBody = r.y >= d.headerH
    const y = d.rect.y + r.y - (inBody ? dscroll : 0)
    const top = Math.max(y, d.rect.y + (inBody ? d.headerH : 0))
    const bottom = Math.min(y + r.h, d.rect.y + d.rect.h)
    return { x: d.rect.x + r.x, y: top, w: r.w, h: bottom - top }
  }
  const r = region(shot, regionName)
  const w = Math.min(r.w, AW - r.x - 12)
  const y = r.y - scroll
  const top = Math.max(y, 4)
  const bottom = Math.min(y + r.h, AH - 4)
  return { x: r.x, y: top, w, h: Math.max(20, bottom - top) }
}

function makeAppClip(clip) {
  const beats = []
  let prev = null
  let t = 0
  for (const b of clip.beats) {
    const st = resolveBeat(b, prev)
    beats.push({ beat: b, st, start: t, end: t + b.dur, prev })
    prev = st
    t += b.dur
  }
  clip.dur = t
  const side = $('#side')

  const render = (lt) => {
    const idx = Math.max(0, beats.findIndex((b) => lt < b.end))
    const cur = beats[idx === -1 ? beats.length - 1 : idx]
    const { st, beat } = cur
    const from = cur.prev ?? st
    const tau = lt - cur.start
    const d = beat.dur
    const tr = beat.move ?? Math.min(1.15, d * 0.42)
    const p = cur.prev ? easeInOut(seg(tau, 0, tr)) : 1

    // クリップ全体の入り・抜け
    const intro = easeOut(seg(lt, 0, 0.7))
    const outro = seg(lt, clip.dur - 0.4, clip.dur)
    app.root.style.display = 'block'
    app.root.style.opacity = String(Math.min(intro, 1 - outro))

    // カメラ
    const c = {}
    for (const k of Object.keys(st.cam)) c[k] = lerp(from.cam[k], st.cam[k], p)
    const drift = 1 + 0.014 * seg(tau, tr * 0.6, d)
    const z = c.z * drift * lerp(0.94, 1, intro)
    const tx = c.sx - (c.iz === 1 && !st.side && !from.side ? c.cx : AW / 2) * z
    const ty = c.sy - ((c.iz === 1 && !st.side && !from.side ? c.cy : AH / 2) + BAR) * z + (1 - intro) * 50
    app.win.style.transform = `translate(${tx}px, ${ty}px) scale(${z}) rotateX(${c.rx}deg) rotateY(${c.ry}deg)`
    const innerMode = !!(st.side || from.side || st.cam.iz !== 1 || from.cam.iz !== 1)
    if (innerMode) {
      const iz = c.iz * (st.side ? drift : 1)
      const cx = clamp(c.cx, AW / 2 / iz, AW - AW / 2 / iz)
      const cy = clamp(c.cy, AH / 2 / iz, AH - AH / 2 / iz)
      app.world.style.transform = `translate(${AW / 2 - cx * iz}px, ${AH / 2 - cy * iz}px) scale(${iz})`
    } else app.world.style.transform = 'none'
    const scale = z * (innerMode ? c.iz : 1)

    // ショット（切り替えはクロスフェード）
    const switching = cur.prev && from.shot !== st.shot
    const xf = switching ? seg(tau, 0, 0.45) : 1
    for (const [id, s] of Object.entries(app.shots)) {
      const isCur = id === st.shot
      const isPrev = switching && id === from.shot && xf < 1
      s.node.style.display = isCur || isPrev ? 'block' : 'none'
      if (isCur) {
        s.node.style.opacity = String(xf)
        s.node.style.zIndex = '2'
        const sc = switching ? st.scroll : lerp(from.scroll, st.scroll, p)
        s.content.style.transform = `translateY(${-sc}px)`
      } else if (isPrev) {
        s.node.style.opacity = '1'
        s.node.style.zIndex = '1'
        s.content.style.transform = `translateY(${-from.scroll}px)`
      }
    }

    // ダイアログ
    const dOpen = st.dialog && from.dialog !== st.dialog ? easeOut(seg(tau, 0.05, 0.5)) : st.dialog ? 1 : 0
    const dClose = !st.dialog && from.dialog ? 1 - seg(tau, 0, 0.3) : 0
    app.dim.style.opacity = String(Math.max(dOpen, dClose))
    app.dim.style.zIndex = '3'
    for (const [id, dl] of Object.entries(app.dialogs)) {
      const showing = id === st.dialog
      const leaving = !st.dialog && id === from.dialog && dClose > 0
      dl.node.style.display = showing || leaving ? 'block' : 'none'
      dl.node.style.zIndex = '4'
      if (showing) {
        dl.node.style.opacity = String(dOpen)
        dl.node.style.transform = `scale(${lerp(0.95, 1, dOpen)})`
        const ds = from.dialog === st.dialog ? lerp(from.dscroll, st.dscroll, p) : st.dscroll
        dl.body.style.transform = `translateY(${-ds}px)`
      } else if (leaving) {
        dl.node.style.opacity = String(dClose)
      }
    }

    // 出力した PDF
    for (const [id, pp] of Object.entries(app.papers)) {
      const on = st.paper && id === st.shot
      const was = from.paper && id === from.shot
      const a = on ? (was ? 1 : easeOutBack(seg(tau, 0.1, 0.75))) : was ? 1 - seg(tau, 0, 0.3) : 0
      pp.node.style.display = a > 0 ? 'block' : 'none'
      if (a > 0) {
        const h = 740
        const w = h / pp.ratio
        pp.node.style.cssText += `left:${(AW + 264 - w) / 2 + 150}px;top:${(AH - h) / 2 + 10}px;width:${w}px;z-index:5;opacity:${clamp(a, 0, 1)};transform:translateY(${(1 - a) * 60}px) rotate(${lerp(4, 1.2, a)}deg)`
      }
    }

    // ハイライト
    const hl = st.hl
    const hlKeep = hl && cur.prev && from.hl && from.hl.x === hl.x && from.hl.y === hl.y && from.hl.w === hl.w
    const next = beats[idx + 1]
    const hlStay = hl && next && next.st.hl && next.st.hl.x === hl.x && next.st.hl.y === hl.y && next.st.shot === st.shot
    if (hl) {
      const a = Math.min(hlKeep ? 1 : seg(tau, tr * 0.75, tr * 0.75 + 0.3), hlStay ? 1 : 1 - seg(tau, d - 0.3, d - 0.05))
      const grow = hlKeep ? 0 : (1 - easeOut(seg(tau, tr * 0.75, tr * 0.75 + 0.45))) * 14
      const padS = 6
      app.spot.style.cssText = `left:${hl.x - padS - grow}px;top:${hl.y - padS - grow}px;width:${hl.w + (padS + grow) * 2}px;height:${hl.h + (padS + grow) * 2}px;opacity:${a};z-index:6;--bw:${3 / scale}px;border-radius:${10 / Math.sqrt(scale)}px`
      app.spotLbl.textContent = hl.label
      app.spotLbl.style.display = hl.label ? 'block' : 'none'
      app.spotLbl.classList.toggle('in', hl.y < (st.dialog ? shotInfo(st.dialog).dialog.rect.y + shotInfo(st.dialog).dialog.headerH + 44 / scale : 50 / scale) + 6)
      app.spotLbl.style.transform = `scale(${1 / scale})`
    } else app.spot.style.opacity = '0'

    // カーソル
    if (st.cursor) {
      const mv = easeInOut(seg(tau, tr * 0.35, tr * 0.35 + 0.85))
      const x = lerp(from.cursorPos.x, st.cursor.x, mv)
      const y = lerp(from.cursorPos.y, st.cursor.y, mv) - Math.sin(mv * Math.PI) * 26
      const clickAt = beat.click ? d - 0.42 : Infinity
      const press = beat.click ? Math.sin(seg(tau, clickAt, clickAt + 0.22) * Math.PI) : 0
      const rp = beat.click ? seg(tau, clickAt + 0.05, clickAt + 0.42) : 0
      const a = Math.min(seg(tau, 0, 0.25), from.cursor || !cur.prev ? 1 : 1)
      app.cursor.style.cssText = `opacity:${a};z-index:7;transform:translate(${x}px, ${y}px) scale(${1.25 / Math.sqrt(scale)})`
      $('svg', app.cursor).style.transform = `scale(${1 - press * 0.16})`
      const rip = $('.ripple', app.cursor)
      rip.style.opacity = String(rp > 0 && rp < 1 ? 1 - rp : 0)
      rip.style.transform = `scale(${0.3 + rp * 1.2})`
    } else app.cursor.style.opacity = String(from.cursor && cur.prev ? 1 - seg(tau, 0, 0.25) : 0)

    // サイドのコピー
    const sd = st.side
    if (sd || from.side) {
      side.style.display = 'block'
      const changed = cur.prev && from.side !== st.side && from.side?.t !== sd?.t
      const a = sd ? (changed || !cur.prev ? easeOut(seg(tau, 0.1, 0.7)) : 1) : 1 - seg(tau, 0, 0.3)
      const shown = sd ?? from.side
      const key = JSON.stringify(shown)
      if (side.dataset.key !== key) {
        side.dataset.key = key
        side.innerHTML = `<div class="side-inner"><div class="k">${shown.k ?? ''}</div><div class="t">${shown.t ?? ''}</div><div class="d">${shown.d ?? ''}</div>${shown.list ? `<ul>${shown.list.map((l, i) => `<li class="${i === shown.on ? 'on' : ''}">${l}</li>`).join('')}</ul>` : ''}</div>`
      }
      side.style.opacity = String(Math.min(a, 1 - outro))
      side.firstChild.style.transform = `translateX(${(1 - a) * -40}px)`
    } else side.style.display = 'none'

    return { caption: beat.caption, tag: beat.tag, note: beat.note, capIn: seg(tau, 0.12, 0.5), capOut: seg(tau, d - 0.22, d), nextCaption: next?.beat.caption, prevCaption: beats[idx - 1]?.beat.caption }
  }
  return { render, hide: () => { app.root.style.display = 'none'; $('#side').style.display = 'none' } }
}

// ---------------------------------------------------------------- 文字のクリップ

const reveal = (node, p) => { node.style.transform = `translateY(${(1 - easeOutExpo(p)) * 115}%)` }
const fadeUp = (node, p, dist = 30) => {
  const e = easeOut(p)
  node.style.opacity = String(e)
  node.style.transform = `translateY(${(1 - e) * dist}px)`
}
const maskLine = (cls, html) => `<div class="${cls}"><span class="mask"><span>${html}</span></span></div>`

function makeTextClip(clip, node) {
  const outroAt = clip.dur - 0.45
  const wrapOut = (lt) => {
    const o = seg(lt, outroAt, clip.dur)
    node.style.opacity = String(1 - o)
    node.style.transform = `scale(${1 + o * 0.03})`
  }
  if (clip.type === 'title') {
    node.innerHTML = `<div class="num">${clip.num ?? ''}</div><div class="kicker"><i></i><span>${clip.kicker ?? ''}</span></div><h1><span class="mask"><span>${clip.title}</span></span></h1><div class="sub">${clip.sub ?? ''}</div><div class="points">${(clip.points ?? []).map((p) => `<span>${p}</span>`).join('')}</div>`
    const bar = $('.kicker i', node), kick = $('.kicker span', node), h = $('h1 .mask > span', node), sub = $('.sub', node), pts = [...node.querySelectorAll('.points span')], num = $('.num', node)
    return (lt) => {
      wrapOut(lt)
      bar.style.transform = `scaleX(${easeOutExpo(seg(lt, 0.1, 0.9))})`
      fadeUp(kick, seg(lt, 0.25, 0.8), 12)
      reveal(h, seg(lt, 0.35, 1.25))
      fadeUp(sub, seg(lt, 0.85, 1.5))
      pts.forEach((p, i) => fadeUp(p, seg(lt, 1.3 + i * 0.13, 1.8 + i * 0.13), 18))
      num.style.opacity = String(easeOut(seg(lt, 0.2, 1.6)))
      num.style.transform = `translateX(${(1 - easeOut(seg(lt, 0.2, 2))) * 80 - lt * 6}px)`
    }
  }
  if (clip.type === 'statement') {
    if (clip.align === 'center') node.classList.add('center')
    node.innerHTML = (clip.kicker ? `<div class="kicker">${clip.kicker}</div>` : '') + clip.lines.map((l) => maskLine(`line ${l.cls ?? ''}`, l.text)).join('')
    const kick = $('.kicker', node)
    const lines = [...node.querySelectorAll('.line .mask > span')]
    return (lt) => {
      wrapOut(lt)
      if (kick) fadeUp(kick, seg(lt, 0.1, 0.6), 12)
      lines.forEach((l, i) => {
        const at = clip.lines[i].at ?? 0.25 + i * 0.32
        reveal(l, seg(lt, at, at + 0.95))
      })
    }
  }
  if (clip.type === 'pains') {
    node.innerHTML = `<div class="kicker">${clip.kicker ?? ''}</div>` + clip.items.map((it, i) => `<div class="row"><b>0${i + 1}</b><div class="t"><span class="strike">${it.t}</span></div><div class="d">${it.d}</div></div>`).join('')
    const rows = [...node.querySelectorAll('.row')]
    const kick = $('.kicker', node)
    return (lt) => {
      wrapOut(lt)
      fadeUp(kick, seg(lt, 0.1, 0.6), 12)
      rows.forEach((r, i) => {
        const at = 0.35 + i * (clip.gap ?? 1.1)
        fadeUp(r, seg(lt, at, at + 0.6), 40)
        $('.strike', r).style.setProperty('--strike', String(clip.strikeAt ? easeInOut(seg(lt, clip.strikeAt + i * 0.18, clip.strikeAt + 0.5 + i * 0.18)) : 0))
      })
    }
  }
  if (clip.type === 'cards') {
    const cols = clip.cols ?? Math.min(4, clip.items.length)
    node.innerHTML = `<div class="kicker">${clip.kicker ?? ''}</div><h2><span class="mask"><span>${clip.title}</span></span></h2><div class="grid" style="grid-template-columns:repeat(${cols},1fr)">${clip.items.map((it, i) => `<div class="card"><div class="n">${it.n ?? String(i + 1).padStart(2, '0')}</div><div class="t">${it.t}</div><div class="d">${it.d}</div></div>`).join('')}</div>${clip.foot ? `<div class="foot">${clip.foot}</div>` : ''}`
    const kick = $('.kicker', node), h = $('h2 .mask > span', node), cards = [...node.querySelectorAll('.card')], foot = $('.foot', node)
    return (lt) => {
      wrapOut(lt)
      fadeUp(kick, seg(lt, 0.1, 0.6), 12)
      reveal(h, seg(lt, 0.2, 1.1))
      cards.forEach((c, i) => {
        const at = 0.7 + i * (clip.gap ?? 0.28)
        fadeUp(c, seg(lt, at, at + 0.6), 46)
      })
      if (foot) fadeUp(foot, seg(lt, 0.9 + cards.length * (clip.gap ?? 0.28), 1.6 + cards.length * (clip.gap ?? 0.28)), 14)
    }
  }
  if (clip.type === 'logo') {
    node.innerHTML = `<div class="mark">${LOGO_SVG}</div><div class="name"><span class="mask"><span>レブスト</span></span></div><div class="en">REVENUE STREAM</div><div class="tagline">${clip.tagline ?? ''}</div><div class="small">${clip.small ?? ''}</div>`
    const mark = $('.mark', node), name = $('.name .mask > span', node), en = $('.en', node), tag = $('.tagline', node), small = $('.small', node)
    return (lt) => {
      const o = clip.last ? seg(lt, clip.dur - 0.8, clip.dur - 0.1) : seg(lt, outroAt, clip.dur)
      node.style.opacity = String(1 - o)
      const m = seg(lt, 0.1, 0.9)
      mark.style.opacity = String(seg(lt, 0.1, 0.4))
      mark.style.transform = `scale(${lerp(0.6, 1, easeOutBack(m))}) rotate(${(1 - easeOut(m)) * -12}deg)`
      reveal(name, seg(lt, 0.45, 1.35))
      en.style.opacity = String(easeOut(seg(lt, 0.9, 1.6)))
      en.style.letterSpacing = `${lerp(0.9, 0.5, easeOut(seg(lt, 0.9, 2.2)))}em`
      fadeUp(tag, seg(lt, 1.5, 2.2), 24)
      fadeUp(small, seg(lt, 2.1, 2.8), 14)
    }
  }
  throw new Error(`未知のクリップ: ${clip.type}`)
}

// ---------------------------------------------------------------- 全体

function usedShotsOf(v) {
  const ids = new Set()
  for (const c of v.clips) for (const b of c.beats ?? []) { if (b.shot) ids.add(b.shot); if (b.dialog) ids.add(b.dialog) }
  return [...ids]
}

export async function loadVideo(id) {
  manifest = await (await fetch('../captures/manifest.json')).json()
  video = (await import(`../storyboards/${id}.js`)).default
  await document.fonts.ready
  await buildApp(usedShotsOf(video))
  const clipsRoot = $('#clips')
  clipsRoot.innerHTML = ''
  timeline = []
  let t = 0
  for (const clip of video.clips) {
    let item
    if (clip.type === 'app') {
      const a = makeAppClip(clip)
      item = { clip, render: a.render, hide: a.hide, isApp: true }
    } else {
      const node = el('div', `clip ${clip.type}`)
      clipsRoot.append(node)
      const r = makeTextClip(clip, node)
      item = { clip, node, render: (lt) => { node.style.display = 'flex'; r(lt); return { caption: clip.caption, capIn: seg(lt, 0.5, 0.9), capOut: seg(lt, clip.dur - 0.5, clip.dur - 0.2) } }, hide: () => { node.style.display = 'none' } }
    }
    item.start = t
    t += clip.dur
    item.end = t
    timeline.push(item)
  }
  duration = t
  $('.chip-kicker').textContent = video.kicker ?? ''
  $('.chip-title').textContent = video.title ?? ''
  seek(0)
  return { duration, fps: video.fps ?? 30, title: video.title, kicker: video.kicker, poster: video.poster ?? 3, cues: cues() }
}

/** 字幕（SRT・ナレーション原稿用）: 表示する順の { start, end, text } */
function cues() {
  const out = []
  for (const item of timeline) {
    if (item.clip.type === 'app') {
      let t = item.start
      for (const b of item.clip.beats) {
        if (b.caption || b.narration) {
          const last = out[out.length - 1]
          if (b.caption && last && last.text === b.caption && Math.abs(last.end - t) < 0.01) last.end = t + b.dur
          else out.push({ start: t, end: t + b.dur, text: b.caption ?? '', narration: b.narration })
        }
        t += b.dur
      }
    } else if (item.clip.caption || item.clip.narration) {
      out.push({ start: item.start + 0.4, end: item.end - 0.2, text: item.clip.caption ?? '', narration: item.clip.narration })
    }
  }
  return out
}

const strip = (s) => (s ?? '').replace(/<[^>]+>/g, '')

export function seek(t) {
  t = clamp(t, 0, duration - 1e-6)
  const cur = timeline.find((i) => t < i.end) ?? timeline[timeline.length - 1]
  for (const i of timeline) if (i !== cur) i.hide()
  if (!cur.isApp) { app.root.style.display = 'none'; $('#side').style.display = 'none' }
  const lt = t - cur.start
  const hud = cur.render(lt) ?? {}

  // 背景のゆっくりした動き
  $('.bg-glow.a').style.transform = `translate(${Math.sin(t * 0.21) * 90}px, ${Math.cos(t * 0.17) * 60}px)`
  $('.bg-glow.b').style.transform = `translate(${Math.cos(t * 0.19) * 80}px, ${Math.sin(t * 0.23) * 70}px)`
  $('.bg-grid').style.transform = `translate(${-(t * 5) % 80}px, ${-(t * 3) % 80}px)`

  // HUD
  const inApp = cur.isApp && !video.hideChip
  const edge = Math.min(seg(lt, 0.3, 0.8), 1 - seg(lt, cur.clip.dur - 0.4, cur.clip.dur))
  $('.chip').style.opacity = String(inApp ? edge : 0)
  const tag = $('.tag')
  tag.style.opacity = String(inApp && hud.tag ? edge : 0)
  if (hud.tag) tag.innerHTML = hud.tag
  const note = $('.note')
  note.style.opacity = String(cur.isApp && hud.note ? Math.min(edge, hud.capIn) : 0)
  note.style.top = inApp ? '92px' : '34px'
  if (hud.note) note.innerHTML = hud.note
  const cap = $('.caption')
  if (hud.caption) {
    const same = cur.isApp && hud.nextCaption === hud.caption
    const cont = cur.isApp && hud.prevCaption === hud.caption
    const a = Math.min(cont ? 1 : easeOut(hud.capIn), same ? 1 : 1 - hud.capOut)
    $('.caption-inner').innerHTML = hud.caption
    cap.style.opacity = String(a)
    cap.style.transform = `translateY(${(1 - (cont ? 1 : easeOut(hud.capIn))) * 16}px)`
  } else cap.style.opacity = '0'
  $('.progress').style.opacity = video.hideProgress ? '0' : '1'
  $('.progress-bar').style.transform = `scaleX(${t / duration})`
  return strip(hud.caption)
}

window.loadVideo = loadVideo
window.seek = seek

// ブラウザで直接開いたときのプレビュー（?id=launch）
const params = new URLSearchParams(location.search)
if (params.get('id')) {
  loadVideo(params.get('id')).then((info) => {
    const stage = $('#stage')
    const fit = () => { stage.style.transform = `scale(${Math.min(innerWidth / STAGE_W, (innerHeight - 44) / STAGE_H)})` }
    fit(); addEventListener('resize', fit)
    const controls = $('#controls'); controls.hidden = false
    const scrub = $('#scrub'), time = $('#time'), play = $('#play')
    let playing = false, t0 = 0, base = 0
    const show = (t) => { seek(t); scrub.value = String((t / info.duration) * 1000); time.textContent = `${t.toFixed(1)} / ${info.duration.toFixed(1)}s` }
    scrub.oninput = () => { playing = false; base = (Number(scrub.value) / 1000) * info.duration; show(base) }
    play.onclick = () => { playing = !playing; t0 = performance.now() }
    const tick = (now) => { if (playing) { const t = base + (now - t0) / 1000; if (t >= info.duration) { playing = false; base = 0 } else show(t) } else if (t0) { base = (Number(scrub.value) / 1000) * info.duration; t0 = 0 } requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    show(Number(params.get('t') ?? 0)); base = Number(params.get('t') ?? 0)
  })
}
