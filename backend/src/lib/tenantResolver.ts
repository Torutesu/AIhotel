// リクエストのホスト名からテナントを識別する（SAAS_DECISIONS.md D-08）。
//
// 例: APP_BASE_DOMAIN が "app.example.com" のとき
//   alpha.app.example.com → "alpha"
//   app.example.com       → null（テナント指定なし）
//   www.app.example.com   → null（予約サブドメイン）
//
// サブドメインでテナントが決まるため、ログイン画面でテナントを聞く必要がなくなる。

/** テナントとして扱わないサブドメイン */
const RESERVED_SUBDOMAINS = new Set(['www', 'api', 'app', 'admin', 'static', 'assets'])

/** テナントコードの形式（Tenant.code と同じ規則） */
const TENANT_CODE_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

/**
 * Host ヘッダーからテナントコードを取り出す。
 * 判定できない場合は null（呼び出し側で別の手段にフォールバックする）。
 */
export function extractTenantCodeFromHost(
  host: string | undefined,
  baseDomain: string | undefined
): string | null {
  if (!host || !baseDomain) return null

  // ポート番号を除去し、大文字・末尾ドットを正規化する
  const normalizedHost = host.split(':')[0].trim().toLowerCase().replace(/\.$/, '')
  const normalizedBase = baseDomain.trim().toLowerCase().replace(/\.$/, '')
  if (!normalizedHost || !normalizedBase) return null

  if (normalizedHost === normalizedBase) return null
  if (!normalizedHost.endsWith(`.${normalizedBase}`)) return null

  const subdomain = normalizedHost.slice(0, -(normalizedBase.length + 1))
  // 多段サブドメイン（a.b.base）はテナントとして扱わない
  if (!subdomain || subdomain.includes('.')) return null
  if (RESERVED_SUBDOMAINS.has(subdomain)) return null
  if (!TENANT_CODE_PATTERN.test(subdomain)) return null

  return subdomain
}

/**
 * CORS で許可するオリジンかどうか。
 * ベースドメイン自身と、その直下のサブドメイン（＝各テナント）を許可する。
 */
export function isAllowedOrigin(
  origin: string,
  baseDomain: string | undefined,
  explicitOrigins: string[]
): boolean {
  if (explicitOrigins.includes(origin)) return true
  if (!baseDomain) return false

  let hostname: string
  let protocol: string
  try {
    const url = new URL(origin)
    hostname = url.hostname.toLowerCase()
    protocol = url.protocol
  } catch {
    return false
  }
  // テナント用オリジンは HTTPS のみ許可する
  if (protocol !== 'https:') return false

  const normalizedBase = baseDomain.trim().toLowerCase().replace(/\.$/, '')
  if (hostname === normalizedBase) return true
  if (!hostname.endsWith(`.${normalizedBase}`)) return false

  const subdomain = hostname.slice(0, -(normalizedBase.length + 1))
  return subdomain.length > 0 && !subdomain.includes('.')
}
