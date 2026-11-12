// robots.txt の解釈（D-13 — 競合サイトの自前巡回の基盤。RFC 9309）。
// - 自分の User-Agent の名前（製品名の部分）に合うグループ、無ければ * のグループを使う
// - Allow / Disallow は最も長く一致した規則を使い、同じ長さなら Allow を優先する。* と末尾の $ に対応する
// - Crawl-delay（秒）は RFC にないが広く使われているので、巡回の間隔の下限として尊重する

export interface RobotsRules {
  rules: Array<{ allow: boolean; pattern: string }>
  crawlDelaySec: number | null
}

/** 何も禁止しない（robots.txt が 404 などで無いとき） */
export const ALLOW_ALL: RobotsRules = { rules: [], crawlDelaySec: null }
/** すべて禁止（robots.txt が 5xx・取得できないとき。RFC 9309 では「すべて禁止」とみなす） */
export const DISALLOW_ALL: RobotsRules = { rules: [{ allow: false, pattern: '/' }], crawlDelaySec: null }

/** User-Agent の文字列から、robots.txt で照らし合わせる名前（例 "RevSt-RevenueBot/1.0 (+...)" → "revst-revenuebot"） */
export function productToken(userAgent: string): string {
  return userAgent.split(/[/\s]/)[0].toLowerCase()
}

export function parseRobotsTxt(text: string, userAgent: string): RobotsRules {
  const token = productToken(userAgent)
  type Group = { agents: string[]; rules: RobotsRules['rules']; crawlDelaySec: number | null }
  const groups: Group[] = []
  let current: Group | null = null
  let lastWasAgent = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const key = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelaySec: null }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!current) continue
    if (key === 'allow' || key === 'disallow') {
      if (value === '') continue // 空の Disallow は「何も禁止しない」
      current.rules.push({ allow: key === 'allow', pattern: value })
    } else if (key === 'crawl-delay') {
      const sec = Number(value)
      if (Number.isFinite(sec) && sec >= 0) current.crawlDelaySec = sec
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && token.startsWith(a)))
  const chosen = mine.length > 0 ? mine : groups.filter((g) => g.agents.includes('*'))
  return {
    rules: chosen.flatMap((g) => g.rules),
    crawlDelaySec: chosen.reduce<number | null>((max, g) => (g.crawlDelaySec == null ? max : Math.max(max ?? 0, g.crawlDelaySec)), null),
  }
}

function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith('$')
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${body}${anchored ? '$' : ''}`)
}

/** パス（クエリ文字列を含む。例 "/hotel/123?date=2026-12-01"）を巡回してよいか */
export function isAllowed(rules: RobotsRules, pathWithQuery: string): boolean {
  let best: { allow: boolean; length: number } | null = null
  for (const rule of rules.rules) {
    if (!patternToRegExp(rule.pattern).test(pathWithQuery)) continue
    const length = rule.pattern.length
    if (!best || length > best.length || (length === best.length && rule.allow)) best = { allow: rule.allow, length }
  }
  return best?.allow ?? true
}
