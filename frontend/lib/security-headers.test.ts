import { describe, it, expect } from "vitest"

import { buildContentSecurityPolicy } from "@/lib/security-headers"

describe("buildContentSecurityPolicy（#85）", () => {
  it("スクリプトは自オリジンと nonce 付きのものだけを許可し、インラインを一律には許さない", () => {
    const csp = buildContentSecurityPolicy("abc123", { isDev: false })
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'")
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/)
    expect(csp).not.toContain("'unsafe-eval'")
  })

  it("埋め込みとプラグインを禁止し、API は same-origin に限る", () => {
    const csp = buildContentSecurityPolicy("n", { isDev: false })
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("connect-src 'self'")
  })

  it("開発サーバーでだけ eval を許可する", () => {
    expect(buildContentSecurityPolicy("n", { isDev: true })).toContain("'unsafe-eval'")
  })
})
