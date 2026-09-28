// CDPリレー（ホテル端末のChromeを、同じLANの別PCから操作するための中継 — #6）。
//
// 用途: エージェント（browser-use等）を自分のノートPCで動かしつつ、
// ブラウザ本体はホテル端末で動かしたいとき。TL-リンカーンへの通信は
// ホテル端末のChromeから出るので、IP制限を満たしたまま操作できる。
//
//   ホテル端末: Chrome(--remote-debugging-port=9222) ← cdp-relay(0.0.0.0:9223)
//   自分のPC  : エージェント → ws://<ホテル端末のIP>:9223
//
// Chromeのデバッグポートは 127.0.0.1 からの接続しか受け付けないため素通しはできない。
// さらに Chrome は DNSリバインディング対策として Host ヘッダを検証し、
// localhost / IP 以外だと 403 を返す。そこでこのリレーは HTTP と WebSocket の
// アップグレード要求に含まれる Host を 127.0.0.1:9222 に書き換えてから中継する。
//
//   node cdp-relay.mjs --listen 9223 --target 9222
//
// 注意:
// - デバッグポートに繋げた相手はブラウザを完全に操作できる。LAN内の限られた時間だけ動かし、
//   終わったら必ず止める。インターネットに向けて開けない。
// - Windowsのファイアウォールが受信を尋ねてくる場合がある（許可には管理者権限が要ることがある）。
//   その場合は諦めてエージェントをホテル端末側で動かす。

import net from 'node:net'

function parseArgs(argv) {
  const get = (name, fallback) => {
    const index = argv.indexOf(`--${name}`)
    return index >= 0 ? Number(argv[index + 1]) : fallback
  }
  return {
    listenPort: get('listen', 9223),
    targetPort: get('target', 9222),
    // 既定は同一LANのみを想定。待ち受けアドレスを絞りたいときに使う
    host: argv.includes('--host') ? argv[argv.indexOf('--host') + 1] : '0.0.0.0',
  }
}

const options = parseArgs(process.argv.slice(2))
const targetHost = `127.0.0.1:${options.targetPort}`

/**
 * 先頭のHTTPヘッダ部だけを見て Host を書き換える。
 * ヘッダが1パケットに収まらない場合に備え、\r\n\r\n が現れるまでバッファする。
 */
function rewriteHost(buffer) {
  const text = buffer.toString('latin1')
  const headerEnd = text.indexOf('\r\n\r\n')
  if (headerEnd === -1) return null // まだヘッダが揃っていない

  const head = text.slice(0, headerEnd)
  const rest = buffer.subarray(Buffer.byteLength(head, 'latin1') + 4)
  const rewritten = head.replace(/^Host:.*$/im, `Host: ${targetHost}`)
  return Buffer.concat([Buffer.from(rewritten, 'latin1'), Buffer.from('\r\n\r\n', 'latin1'), rest])
}

const server = net.createServer((client) => {
  const upstream = net.connect(options.targetPort, '127.0.0.1')
  let pending = Buffer.alloc(0)
  let headerDone = false

  client.on('data', (chunk) => {
    if (headerDone) {
      upstream.write(chunk)
      return
    }
    pending = Buffer.concat([pending, chunk])
    const rewritten = rewriteHost(pending)
    if (rewritten) {
      headerDone = true
      pending = Buffer.alloc(0)
      upstream.write(rewritten)
    }
  })

  upstream.on('data', (chunk) => client.write(chunk))

  const close = () => {
    client.destroy()
    upstream.destroy()
  }
  client.on('error', close)
  upstream.on('error', close)
  client.on('close', close)
  upstream.on('close', close)
})

server.listen(options.listenPort, options.host, () => {
  console.log(
    `CDPリレーを開始しました: ${options.host}:${options.listenPort} → 127.0.0.1:${options.targetPort}`
  )
  console.log('接続できる相手はブラウザを完全に操作できます。使い終わったら Ctrl+C で止めてください。')
})
