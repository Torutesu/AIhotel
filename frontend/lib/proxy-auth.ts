// API 中継（app/api/[...path]/route.ts）とバックエンドが共有する秘密の値のヘッダー（R-2-3）。
//
// バックエンドは PROXY_SHARED_SECRET を設定すると、このヘッダーで同じ値を送ってきた要求しか受け付けない
// （backend/src/middlewares/proxyAuth.ts）。中継を通らない直接の呼び出しと、X-Forwarded-For の偽装を防ぐ。
// ブラウザには値を出さない（サーバー専用の環境変数から読み、中継の中だけで付ける）。
//
// DOM・Next.js 非依存の純関数にしてユニットテストで固定する。

export const PROXY_AUTH_HEADER = "x-proxy-auth"

/**
 * バックエンドへ送るヘッダーに秘密の値を付ける。
 * クライアントが送ってきた同名のヘッダーは必ず捨てる（値を知らない第三者の値をそのまま中継しない）
 */
export function applyProxyAuth(headers: Headers, secret: string | undefined): void {
  headers.delete(PROXY_AUTH_HEADER)
  if (secret) headers.set(PROXY_AUTH_HEADER, secret)
}
