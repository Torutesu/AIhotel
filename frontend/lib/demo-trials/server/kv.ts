// デモのトライアルを共有保存する先（サーバー専用）。
//
// Vercel の Marketplace から作れる Upstash Redis（無料枠）を REST API で使う。追加のライブラリは入れない。
// 接続情報は Vercel がプロジェクトに入れる環境変数（KV_REST_API_URL / KV_REST_API_TOKEN、
// または UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN）から読む。未設定なら共有保存は無効。

export interface DemoKv {
  get(key: string): Promise<string | null>
  /** 無ければ保存して true。既にあれば何もせず false */
  setIfAbsent(key: string, value: string): Promise<boolean>
  compareAndSet(key: string, expected: string, value: string): Promise<boolean>
  hgetall(key: string): Promise<Record<string, string>>
  hset(key: string, field: string, value: string): Promise<void>
  hdel(key: string, field: string): Promise<void>
  /** 数を1増やし、最初の1回目なら ttlSeconds 秒で消えるようにする。増やした後の値を返す */
  incrWithTtl(key: string, ttlSeconds: number): Promise<number>
  del(key: string): Promise<void>
}

type Env = Record<string, string | undefined>

export function kvConfigFromEnv(env: Env): { url: string; token: string } | null {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN
  return url && token ? { url: url.replace(/\/$/, ""), token } : null
}

/** Upstash Redis の REST API（コマンドを JSON 配列で POST する） */
export function upstashKv(config: { url: string; token: string }): DemoKv {
  async function command<T>(...args: Array<string | number>): Promise<T> {
    const res = await fetch(config.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
      cache: "no-store",
    })
    const body = (await res.json().catch(() => null)) as { result?: T; error?: string } | null
    if (!res.ok || !body || body.error) {
      throw new Error(`共有保存（Upstash）への ${String(args[0])} に失敗しました: ${res.status} ${body?.error ?? ""}`)
    }
    return body.result as T
  }

  return {
    get: (key) => command<string | null>("GET", key),
    async setIfAbsent(key, value) {
      return (await command<string | null>("SET", key, value, "NX")) === "OK"
    },
    async compareAndSet(key, expected, value) {
      const lua = "if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end redis.call('SET',KEYS[1],ARGV[2]); return 1"
      return (await command<number>("EVAL", lua, 1, key, expected, value)) === 1
    },
    async hgetall(key) {
      const flat = (await command<string[] | null>("HGETALL", key)) ?? []
      const out: Record<string, string> = {}
      for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i]] = flat[i + 1]
      return out
    },
    async hset(key, field, value) {
      await command("HSET", key, field, value)
    },
    async hdel(key, field) {
      await command("HDEL", key, field)
    },
    async incrWithTtl(key, ttlSeconds) {
      const count = await command<number>("INCR", key)
      if (count === 1) await command("EXPIRE", key, ttlSeconds)
      return count
    },
    async del(key) {
      await command("DEL", key)
    },
  }
}

/** テスト用のメモリ上の実装 */
export function memoryKv(): DemoKv {
  const strings = new Map<string, string>()
  const hashes = new Map<string, Map<string, string>>()
  const counters = new Map<string, number>()
  return {
    // Redis と同じく、INCR した数も GET で読める
    get: async (key) => strings.get(key) ?? (counters.has(key) ? String(counters.get(key)) : null),
    async setIfAbsent(key, value) {
      if (strings.has(key)) return false
      strings.set(key, value)
      return true
    },
    async compareAndSet(key, expected, value) {
      if (strings.get(key) !== expected) return false
      strings.set(key, value)
      return true
    },
    hgetall: async (key) => Object.fromEntries(hashes.get(key) ?? []),
    async hset(key, field, value) {
      if (!hashes.has(key)) hashes.set(key, new Map())
      hashes.get(key)!.set(field, value)
    },
    async hdel(key, field) {
      hashes.get(key)?.delete(field)
    },
    async incrWithTtl(key) {
      const next = (counters.get(key) ?? 0) + 1
      counters.set(key, next)
      return next
    },
    async del(key) {
      strings.delete(key)
      hashes.delete(key)
      counters.delete(key)
    },
  }
}
