import { config } from '../../lib/config.js'

// 外部要因の取得で使う HTTP（D-13）。名乗る User-Agent とタイムアウトをそろえる。

export const EXTERNAL_FETCH_TIMEOUT_MS = 20_000

export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = EXTERNAL_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { 'User-Agent': config.EXTERNAL_FETCH_USER_AGENT, ...(init.headers ?? {}) },
    })
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`タイムアウトしました（${timeoutMs}ms）: ${url}`)
    throw error
  } finally {
    clearTimeout(timer)
  }
}
