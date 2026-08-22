import type {
  ClaimedJob,
  ConnectorDefinition,
  SyncTarget,
} from '@hotel-revenue-system/shared/types'
import type { AgentConfig } from './config.js'

// backend との通信クライアント。外向きHTTPSのみ（インバウンド不要 — 設計書 §2）。
// ネットワークエラーは指数バックオフで再試行する。結果報告の耐久性は spool.ts が担う。

interface ApiEnvelope<T> {
  success: boolean
  data?: T
  error?: string
  errors?: Array<{ field: string; message: string }>
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message)
  }
}

export class NetworkError extends Error {}

const RETRYABLE_DELAYS_MS = [2_000, 4_000, 8_000]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class BackendClient {
  constructor(
    private readonly config: AgentConfig,
    private token: string | null
  ) {}

  setToken(token: string): void {
    this.token = token
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    opts: { retry?: boolean; auth?: boolean } = {}
  ): Promise<T> {
    const { retry = true, auth = true } = opts
    const url = `${this.config.backendUrl}/api/v1/connector${path}`
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (auth) {
      if (!this.token) throw new ApiError(401, 'デバイストークンがありません。先にペアリングしてください')
      headers.Authorization = `Bearer ${this.token}`
    }

    let lastError: unknown
    const attempts = retry ? RETRYABLE_DELAYS_MS.length + 1 : 1
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await fetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        })
        const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null
        if (!res.ok || !json || !json.success) {
          // 4xx/5xx はネットワーク再試行の対象外（呼び出し側が意味を判断する）
          throw new ApiError(res.status, json?.error ?? `HTTP ${res.status}`)
        }
        return json.data as T
      } catch (error) {
        if (error instanceof ApiError) throw error
        lastError = error
        if (i < attempts - 1) await sleep(RETRYABLE_DELAYS_MS[i])
      }
    }
    throw new NetworkError(`backendへの接続に失敗しました: ${String(lastError)}`)
  }

  pair(code: string): Promise<{ deviceToken: string; device: { id: string; hotelId: string; name: string } }> {
    return this.request('POST', '/devices/pair', { code, agentVersion: this.config.agentVersion }, { auth: false })
  }

  heartbeat(): Promise<{ serverTime: string }> {
    return this.request('POST', '/heartbeat', { agentVersion: this.config.agentVersion })
  }

  async claimJob(): Promise<ClaimedJob | null> {
    const data = await this.request<{ job: ClaimedJob | null }>('GET', '/jobs/next')
    return data.job
  }

  extendLease(jobId: string): Promise<{ leaseExpiresAt: string }> {
    return this.request('POST', `/jobs/${jobId}/lease`, {})
  }

  reportResult(jobId: string, body: unknown): Promise<{ status: string }> {
    // 再試行はspool側の責務（二重送信を避けるためここでは1回だけ）
    return this.request('POST', `/jobs/${jobId}/result`, body, { retry: false })
  }

  uploadArtifact(jobId: string, body: unknown): Promise<{ id: string }> {
    return this.request('POST', `/jobs/${jobId}/artifacts`, body, { retry: false })
  }

  async getDefinition(target: SyncTarget): Promise<ConnectorDefinition> {
    const data = await this.request<{ definition: ConnectorDefinition }>(
      'GET',
      `/definitions?target=${target}`
    )
    return data.definition
  }

  rotateToken(): Promise<{ deviceToken: string }> {
    return this.request('POST', '/devices/rotate-token', {})
  }
}
