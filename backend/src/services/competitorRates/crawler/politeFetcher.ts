import { ALLOW_ALL, DISALLOW_ALL, isAllowed, parseRobotsTxt, type RobotsRules } from './robots.js'

// 競合サイトを巡回するときの HTTP（D-13 — 自前巡回の基盤）。types.ts の約束（robots.txt の尊重・数秒おき）をここで守る。
// - サイトごとに robots.txt を読み（24時間キャッシュ）、禁止されたパスは取りに行かない（RobotsDisallowedError）
// - 同じホストへのリクエストは minIntervalMs（と robots.txt の Crawl-delay の長いほう）以上あける
// - 429 / 503 は Retry-After（無ければ間隔の2倍）だけ待って最大 MAX_RETRIES 回やり直す。それ以外の失敗はすぐ例外
// - 名乗る User-Agent は config の EXTERNAL_FETCH_USER_AGENT（連絡先を入れる）

export const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000
export const MAX_RETRIES = 2
const MAX_RETRY_AFTER_MS = 60_000

export class RobotsDisallowedError extends Error {
  constructor(url: string) {
    super(`robots.txt で禁止されているため取得しません: ${url}`)
    this.name = 'RobotsDisallowedError'
  }
}

export interface PoliteFetcherOptions {
  userAgent: string
  minIntervalMs: number
  timeoutMs?: number
  /** テスト用に差し替える */
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export class PoliteFetcher {
  private readonly robots = new Map<string, { rules: RobotsRules; fetchedAt: number }>()
  private readonly lastRequestAt = new Map<string, number>()
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number

  constructor(private readonly options: PoliteFetcherOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.now = options.now ?? Date.now
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000)
    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
        headers: { 'User-Agent': this.options.userAgent, 'Accept-Language': 'ja', ...(init.headers ?? {}) },
      })
    } finally {
      clearTimeout(timer)
    }
  }

  /** robots.txt の規則（キャッシュ）。404 などは「すべて許可」、5xx・通信の失敗は「すべて禁止」 */
  async rulesFor(origin: string): Promise<RobotsRules> {
    const cached = this.robots.get(origin)
    if (cached && this.now() - cached.fetchedAt < ROBOTS_TTL_MS) return cached.rules
    let rules: RobotsRules
    try {
      await this.waitTurn(origin, null)
      const res = await this.request(`${origin}/robots.txt`)
      if (res.ok) rules = parseRobotsTxt(await res.text(), this.options.userAgent)
      else if (res.status >= 500) rules = DISALLOW_ALL
      else rules = ALLOW_ALL
    } catch {
      rules = DISALLOW_ALL
    }
    this.robots.set(origin, { rules, fetchedAt: this.now() })
    return rules
  }

  private async waitTurn(origin: string, rules: RobotsRules | null) {
    const interval = Math.max(this.options.minIntervalMs, (rules?.crawlDelaySec ?? 0) * 1000)
    const last = this.lastRequestAt.get(origin)
    if (last != null) {
      const wait = last + interval - this.now()
      if (wait > 0) await this.sleep(wait)
    }
    this.lastRequestAt.set(origin, this.now())
  }

  /** robots.txt を確かめ、間隔をあける（ブラウザで開く前に使う）。禁止なら例外 */
  async permit(url: string): Promise<void> {
    const parsed = new URL(url)
    const rules = await this.rulesFor(parsed.origin)
    if (!isAllowed(rules, `${parsed.pathname}${parsed.search}`)) throw new RobotsDisallowedError(url)
    await this.waitTurn(parsed.origin, rules)
  }

  /** 巡回して本文を返す。禁止・失敗は例外 */
  async getText(url: string, init: RequestInit = {}): Promise<string> {
    const parsed = new URL(url)
    const rules = await this.rulesFor(parsed.origin)
    if (!isAllowed(rules, `${parsed.pathname}${parsed.search}`)) throw new RobotsDisallowedError(url)
    for (let attempt = 0; ; attempt++) {
      await this.waitTurn(parsed.origin, rules)
      const res = await this.request(url, init)
      if (res.ok) return res.text()
      if ((res.status === 429 || res.status === 503) && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('retry-after'))
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : this.options.minIntervalMs * 2
        await this.sleep(Math.min(MAX_RETRY_AFTER_MS, wait))
        continue
      }
      throw new Error(`取得に失敗しました（HTTP ${res.status}）: ${url}`)
    }
  }
}
