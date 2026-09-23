// フロントエンドの Content-Security-Policy（#85）。
// CSP 以外のセキュリティヘッダは next.config.mjs の headers() で付ける。
//
// アクセストークンとリフレッシュトークンは localStorage にあるため、XSS が1件あれば
// 両方が持ち出される。CSP でインラインスクリプトと外部スクリプトを止めて被害を抑える。
// Next.js のブートストラップ用インラインスクリプトは nonce で許可する（middleware.ts が
// リクエストごとに nonce を作り、Next.js がそれを自分のスクリプトに付ける）。
// 'strict-dynamic' により、nonce 付きスクリプトが読み込むスクリプト（チャンク・Vercel Analytics）も許可される。

/** Content-Security-Policy の値を組み立てる（DOM・Node 非依存の純関数） */
export function buildContentSecurityPolicy(nonce: string, options: { isDev: boolean }): string {
  const scriptSrc = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"]
  // 開発サーバーの React Refresh は eval を使う
  if (options.isDev) scriptSrc.push("'unsafe-eval'")

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    // Radix UI・recharts は style 属性で位置やサイズを指定するため、style のインラインは許可する
    "style-src 'self' 'unsafe-inline'",
    // PNG エクスポート（lib/svg-export.ts）は data: / blob: の画像を使う
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // API は same-origin の /api/* 経由（app/api/[...path]/route.ts）
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ")
}
