// 証跡アップロード前のサニタイズ（設計書 §12）。
// Cookie・トークン・パスワード類を backend に送る前にエージェント側でマスクする。
// backend は sanitized: true の宣言がない証跡を受理しないが、
// 実際のマスクはここで行われる（宣言だけで生データを送ってはならない）。

const SENSITIVE_NAME_PATTERN = /(password|passwd|token|session|csrf|auth|secret|cookie)/i

/**
 * HTMLスナップショットから秘密情報らしき値をマスクする。
 * - password型inputのvalue
 * - 名前が token/session/csrf/auth 等を含む input（hidden含む）のvalue
 * - Set-Cookie/Authorization を含むテキスト断片
 */
export function sanitizeHtml(html: string): string {
  let out = html

  // input要素のvalueマスク（属性順に依存しないよう2パス）
  out = out.replace(/<input\b[^>]*>/gi, (tag) => {
    const isPassword = /type\s*=\s*["']?password["']?/i.test(tag)
    const nameMatch = tag.match(/name\s*=\s*["']?([^"'\s>]+)/i)
    const idMatch = tag.match(/id\s*=\s*["']?([^"'\s>]+)/i)
    const sensitiveName =
      (nameMatch && SENSITIVE_NAME_PATTERN.test(nameMatch[1])) ||
      (idMatch && SENSITIVE_NAME_PATTERN.test(idMatch[1]))
    if (!isPassword && !sensitiveName) return tag
    return tag.replace(/value\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, 'value="***"')
  })

  // ヘッダ文字列がHTML内に写り込んでいるケース
  out = out.replace(/(Set-Cookie\s*:\s*)[^\n<]+/gi, '$1***')
  out = out.replace(/(Authorization\s*:\s*)[^\n<]+/gi, '$1***')

  // URLクエリに載ったトークン類
  out = out.replace(/([?&](?:token|session|sessionid|auth|apikey|api_key)=)[^&"'\s<]+/gi, '$1***')

  return out
}

/**
 * JSON文字列（抽出データ等）から秘密情報らしきキーの値をマスクする
 */
export function sanitizeJson(jsonText: string): string {
  try {
    const parsed = JSON.parse(jsonText)
    return JSON.stringify(maskObject(parsed))
  } catch {
    return jsonText
  }
}

function maskObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskObject)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_NAME_PATTERN.test(key) ? '***' : maskObject(v)
    }
    return out
  }
  return value
}
