import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const auth = vi.hoisted(() => vi.fn(async () => "test-session"))
vi.mock("./service", () => ({ ADMIN_SESSION_SECONDS: 3600, adminLogin: auth }))
vi.mock("./http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./http")>()
  return { ...actual, handle: async (_request: unknown, _options: unknown, fn: (kv: unknown) => unknown) => fn({}) }
})
import { POST } from "@/app/api/demo/admin/session/route"

function request(email: string) {
  return new NextRequest("https://example.test/api/demo/admin/session", {
    method: "POST", body: JSON.stringify({ email, password: "test-only-password" }),
  })
}

describe("運営 ID のサーバー照合", () => {
  beforeEach(() => {
    auth.mockClear()
    vi.stubEnv("NEXT_PUBLIC_DEMO_ADMIN_CONSOLE", "true")
    vi.stubEnv("DEMO_ADMIN_EMAIL", "owner@example.test")
  })
  it("設定された ID と一致したときだけパスワード認証する", async () => {
    const response = await POST(request(" OWNER@example.test "))
    expect(auth).toHaveBeenCalledOnce()
    expect(await response.json()).toEqual({ success: true, data: { loggedIn: true } })
    expect(response.cookies.get("demo_admin")?.value).toBe("test-session")
  })
  it("別の ID では認証も Cookie 発行もしない", async () => {
    const response = await POST(request("visitor@example.test"))
    expect(auth).not.toHaveBeenCalled()
    expect(response.cookies.get("demo_admin")).toBeUndefined()
    expect(await response.json()).toEqual({ success: true, data: { loggedIn: false } })
  })
  it("ID 未設定ではログインを拒否する", async () => {
    vi.stubEnv("DEMO_ADMIN_EMAIL", "")
    await expect(POST(request("owner@example.test"))).rejects.toMatchObject({ status: 503 })
    expect(auth).not.toHaveBeenCalled()
  })
  it("配布用 URL では運営ログインを拒否する", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_ADMIN_CONSOLE", "")
    await expect(POST(request("owner@example.test"))).rejects.toMatchObject({ status: 403 })
    expect(auth).not.toHaveBeenCalled()
  })
})
