// 取得したページの中身の判定（D-13 — 自前巡回の基盤）。
// - 文字コード: 日本のサイトには Shift_JIS・EUC-JP のページが残っている（じゃらんは Shift_JIS）。Content-Type か <meta charset> で決める
// - ブロックの兆候: CAPTCHA・アクセス制限・ボット判定の画面。見つけたら取得を続けず、そのサイトをしばらく止める
//   （ブロックをすり抜ける工夫はしない。止められたら公式 API・レートショッピング業者に切り替える判断を人がする）

export class SiteBlockedError extends Error {
  constructor(
    readonly url: string,
    readonly reason: string
  ) {
    super(`サイトに止められた兆候があるため取得をやめます（${reason}）: ${url}`)
    this.name = 'SiteBlockedError'
  }
}

const SJIS = /shift[_-]?jis|sjis|windows-31j|cp932|x-sjis/i
const EUC = /euc-jp/i

/** バイト列を、Content-Type か <meta charset> の文字コードで文字列にする（既定は UTF-8） */
export function decodeHtml(bytes: ArrayBuffer | Uint8Array, contentType: string | null): string {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const fromHeader = contentType?.match(/charset=([^;]+)/i)?.[1]?.trim()
  const head = new TextDecoder('latin1').decode(buf.slice(0, 2048))
  const fromMeta = head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1]
  const charset = fromHeader ?? fromMeta ?? 'utf-8'
  const label = SJIS.test(charset) ? 'shift_jis' : EUC.test(charset) ? 'euc-jp' : 'utf-8'
  return new TextDecoder(label).decode(buf)
}

/** ブロック（CAPTCHA・ボット判定・アクセス制限）の画面の手がかり */
const BLOCK_MARKERS: Array<[RegExp, string]> = [
  [/captcha|g-recaptcha|hcaptcha|px-captcha/i, 'CAPTCHA'],
  [/cf-chl-|challenge-platform|Attention Required!? \| Cloudflare/i, 'ボット判定（Cloudflare）'],
  [/_Incapsula_Resource|Request unsuccessful\. Incapsula/i, 'ボット判定（Incapsula）'],
  [/Access Denied|Request blocked|You have been blocked/i, 'アクセス拒否'],
  [/アクセスが集中|アクセス制限|不正なアクセス|アクセスしようとしたページは表示できません/, 'アクセス制限の画面'],
]

/** ブロックの兆候があれば理由、無ければ null。HTTP の状態とページの中身で判断する */
export function detectBlock(status: number, html: string | null): string | null {
  if (status === 401 || status === 403) return `HTTP ${status}`
  if (!html) return null
  // 料金のページは大きい。手がかりは小さな画面にあるので、先頭だけを見る（本文中の「captcha」などの語で誤判定しない）
  const head = html.slice(0, 20_000)
  for (const [pattern, reason] of BLOCK_MARKERS) if (pattern.test(head) && html.length < 200_000) return reason
  return null
}
