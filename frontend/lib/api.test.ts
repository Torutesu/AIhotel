import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import {
  AUTH_EXPIRED_EVENT,
  ApiClientError,
  api,
  clearTokens,
  getAccessToken,
  getRefreshToken,
  isDemoModeEnabled,
  storeTokens,
} from "./api"

/** `{success: true, data}` のエンベロープを返す Response */
function ok(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ success: true, data }),
  } as Response
}

/** `{success: false, error}` のエンベロープを返す Response */
function fail(status: number, error = "エラー"): Response {
  return {
    ok: false,
    status,
    json: async () => ({ success: false, error }),
  } as Response
}

const TOKENS = { accessToken: "new-access", refreshToken: "new-refresh" }

describe("isDemoModeEnabled（デモモードは opt-in）", () => {
  it("NEXT_PUBLIC_DEMO_MODE が未設定なら無効", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", undefined as unknown as string)
    expect(isDemoModeEnabled()).toBe(false)
  })

  it('"true" のときだけ有効', () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true")
    expect(isDemoModeEnabled()).toBe(true)
  })

  it("値の綴り違い・大文字・1 などは無効側に倒す", () => {
    for (const value of ["ture", "TRUE", "True", "1", "yes", ""]) {
      vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", value)
      expect(isDemoModeEnabled(), `"${value}" は無効であるべき`).toBe(false)
    }
  })
})

describe("トークンの保存と破棄", () => {
  it("保存したトークンを読み出せる", () => {
    storeTokens("a", "r")
    expect(getAccessToken()).toBe("a")
    expect(getRefreshToken()).toBe("r")
  })

  it("clearTokens で両方消える", () => {
    storeTokens("a", "r")
    clearTokens()
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })
})

describe("アクセストークンのリフレッシュ（single-flight — F-2）", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    storeTokens("expired-access", "valid-refresh")
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    clearTokens()
  })

  it("並列の 401 でもリフレッシュは1回しか実行しない", async () => {
    const refreshCalls: string[] = []
    let refreshResolve: (() => void) | null = null
    const refreshGate = new Promise<void>((resolve) => {
      refreshResolve = resolve
    })

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/auth/refresh")) {
        refreshCalls.push(String(init?.body))
        // 3本の元リクエストが全て 401 を受け取るまでリフレッシュを完了させない
        await refreshGate
        return ok({ tokens: TOKENS })
      }
      // 更新後のトークンを持っていれば成功、まだ古ければ 401
      const authorization = (init?.headers as Record<string, string>)?.Authorization
      return authorization === `Bearer ${TOKENS.accessToken}` ? ok([]) : fail(401, "認証エラー")
    })

    const inFlight = Promise.all([api.hotels(), api.hotels(), api.hotels()])
    // 3本とも 401 を受けてリフレッシュ待ちに入ってからゲートを開ける
    await vi.waitFor(() => expect(refreshCalls.length).toBeGreaterThan(0))
    refreshResolve!()
    await inFlight

    expect(refreshCalls).toHaveLength(1)
    expect(refreshCalls[0]).toContain("valid-refresh")
    expect(getAccessToken()).toBe(TOKENS.accessToken)
  })

  it("リフレッシュ成功後は新しいトークンで元のリクエストを1度だけ再試行する", async () => {
    const paths: string[] = []
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      paths.push(url)
      if (url.includes("/auth/refresh")) return ok({ tokens: TOKENS })
      const authorization = (init?.headers as Record<string, string>)?.Authorization
      if (authorization === `Bearer ${TOKENS.accessToken}`) return ok([{ id: "h1" }])
      return fail(401)
    })

    await expect(api.hotels()).resolves.toEqual([{ id: "h1" }])
    // 元リクエスト → リフレッシュ → 再試行 の3回
    expect(paths).toHaveLength(3)
    expect(paths[1]).toContain("/api/v1/auth/refresh")
  })

  it("サーバーがリフレッシュを拒否したら auth:expired を発火しトークンを破棄する", async () => {
    const onExpired = vi.fn()
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("/auth/refresh") ? fail(401, "リフレッシュトークンが無効です") : fail(401)
    )

    await expect(api.hotels()).rejects.toBeInstanceOf(ApiClientError)

    expect(onExpired).toHaveBeenCalledTimes(1)
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
    window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  })

  it("リフレッシュトークンが無い場合もその場で auth:expired を発火する", async () => {
    clearTokens()
    storeTokens("expired-access", "")
    localStorage.removeItem("hrms.refreshToken")
    const onExpired = vi.fn()
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    fetchMock.mockImplementation(async () => fail(401))

    await expect(api.hotels()).rejects.toBeInstanceOf(ApiClientError)

    expect(onExpired).toHaveBeenCalledTimes(1)
    window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  })

  it("ネットワーク到達不可のリフレッシュではトークンを破棄しない（失効とは限らない）", async () => {
    const onExpired = vi.fn()
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/auth/refresh")) throw new TypeError("Failed to fetch")
      return fail(401)
    })

    await expect(api.hotels()).rejects.toBeInstanceOf(ApiClientError)

    expect(onExpired).not.toHaveBeenCalled()
    expect(getRefreshToken()).toBe("valid-refresh")
    window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  })

  it("ログイン自体の 401 はリフレッシュせずそのまま失敗させる", async () => {
    const paths: string[] = []
    fetchMock.mockImplementation(async (url: string) => {
      paths.push(url)
      return fail(401, "メールアドレスまたはパスワードが正しくありません")
    })

    await expect(api.login("user@example.com", "wrong")).rejects.toThrow(
      "メールアドレスまたはパスワードが正しくありません"
    )
    expect(paths).toHaveLength(1)
    expect(paths.some((p) => p.includes("/auth/refresh"))).toBe(false)
  })
})

describe("エラー変換", () => {
  it("バックエンドに到達できない場合は isBackendUnreachable を立てる", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch")
      })
    )
    const error = await api.hotels().catch((e) => e)
    expect(error).toBeInstanceOf(ApiClientError)
    expect((error as ApiClientError).isBackendUnreachable).toBe(true)
    expect((error as ApiClientError).status).toBe(0)
  })

  it("デモモードが無効ならモックへフォールバックせずエラーを投げる", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch")
      })
    )
    await expect(api.dashboardKpi("demo-hotel-001", 2026, 9)).rejects.toBeInstanceOf(ApiClientError)
  })

  it("エンベロープのエラーメッセージをそのまま例外にする", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fail(403, "このホテルへのアクセス権がありません")))
    await expect(api.hotels()).rejects.toThrow("このホテルへのアクセス権がありません")
  })
})
