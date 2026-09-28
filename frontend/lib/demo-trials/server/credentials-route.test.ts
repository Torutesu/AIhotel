import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { memoryKv } from "./kv"
import { adminLogin, createTrial } from "./service"

let kv = memoryKv()
vi.mock("./kv", async (original) => ({
  ...await original<typeof import("./kv")>(),
  kvConfigFromEnv: () => ({}),
  upstashKv: () => kv,
}))
import { GET } from "@/app/api/demo/trials/[id]/route"

describe("ログイン情報再表示の認証境界", () => {
  beforeEach(() => {
    kv = memoryKv()
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true")
    vi.stubEnv("NEXT_PUBLIC_DEMO_ADMIN_CONSOLE", "true")
    vi.stubEnv("DEMO_TRIAL_CREDENTIALS_KEY", "d".repeat(64))
    vi.stubEnv("DEMO_PUBLIC_URL", "https://public.example.test")
  })
  it("運営Cookieがある運営URLだけでパスワードを返し、キャッシュさせない", async () => {
    const cookie = await adminLogin(kv, "test-owner-password", null)
    const issued = await createTrial(kv, { name: "Test", kind: "DEALER" })
    const context = { params: Promise.resolve({ id: issued.trial.id }) }
    const url = `https://admin.example.test/api/demo/trials/${issued.trial.id}`
    const anonymous = await GET(new NextRequest(url), context)
    expect(anonymous.status).toBe(401)
    expect(await anonymous.text()).not.toContain(issued.password)
    const request = () => new NextRequest(url, { headers: { cookie: `demo_admin=${cookie}` } })
    const authorized = await GET(request(), context)
    expect(authorized.status).toBe(200)
    expect(authorized.headers.get("cache-control")).toContain("no-store")
    expect((await authorized.json()).data.password).toBe(issued.password)
    vi.stubEnv("NEXT_PUBLIC_DEMO_ADMIN_CONSOLE", "false")
    expect((await GET(request(), context)).status).toBe(403)
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false")
    expect((await GET(request(), context)).status).toBe(404)
  })
})
