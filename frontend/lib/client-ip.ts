// API 中継でバックエンドに渡すクライアント IP の解決（#85）。
//
// クライアントが送ってきた X-Forwarded-For をそのまま中継すると、バックエンドの
// ログインのレート制限や監査ログの IP を偽装できてしまう。信頼できる経路が付けた値だけを
// 使ってクライアント IP を1つに決め、X-Forwarded-For を入れ直す。
//
// - Vercel: Vercel のエッジがクライアントの送った値を捨てて X-Forwarded-For を設定し直すので、先頭を使う
// - それ以外: Next.js の前段にあるプロキシの段数（TRUSTED_PROXY_HOPS、既定1）だけ右から数えた値を使う。
//   各プロキシは自分に接続してきた相手を右端に追記するため、右から N 番目が最初の信頼できるプロキシが見た接続元になる。
//   Next.js を前段プロキシなしで直接公開すると、クライアントが送った値と区別できない（README の構成を参照）
//
// DOM・Next.js 非依存の純関数にしてユニットテストで固定する。

export interface ClientIpOptions {
  onVercel: boolean
  /** Next.js の前段にある信頼できるプロキシの段数 */
  trustedHops: number
}

/** "a, b, c" を分割する。空要素は捨てる */
function parseForwardedFor(value: string | null): string[] {
  if (!value) return []
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/** 解決できなければ null（バックエンドには X-Forwarded-For を渡さない） */
export function resolveClientIp(forwardedFor: string | null, options: ClientIpOptions): string | null {
  const chain = parseForwardedFor(forwardedFor)
  if (chain.length === 0) return null
  if (options.onVercel) return chain[0]

  const hops = Math.max(1, Math.floor(options.trustedHops))
  // 段数より短い連鎖は、どこかで信頼できない経路を通っている。推測で埋めない
  if (chain.length < hops) return null
  return chain[chain.length - hops]
}

/** 環境変数から解決の設定を読む（サーバー専用） */
export function clientIpOptionsFromEnv(env: Record<string, string | undefined>): ClientIpOptions {
  const hops = Number(env.TRUSTED_PROXY_HOPS ?? "1")
  return {
    onVercel: Boolean(env.VERCEL),
    trustedHops: Number.isFinite(hops) && hops >= 1 ? hops : 1,
  }
}
