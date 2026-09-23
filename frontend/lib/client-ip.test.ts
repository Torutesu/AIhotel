import { describe, it, expect } from "vitest"

import { clientIpOptionsFromEnv, resolveClientIp } from "@/lib/client-ip"

describe("resolveClientIp（#85）", () => {
  it("前段プロキシ1段なら右端（プロキシが追記した接続元）を使い、クライアントが送った値は無視する", () => {
    // 攻撃者が "1.1.1.1" を送り、前段プロキシが実際の接続元 203.0.113.9 を追記した
    expect(resolveClientIp("1.1.1.1, 203.0.113.9", { onVercel: false, trustedHops: 1 })).toBe("203.0.113.9")
  })

  it("前段プロキシ2段なら右から2番目を使う", () => {
    expect(
      resolveClientIp("1.1.1.1, 203.0.113.9, 10.0.0.5", { onVercel: false, trustedHops: 2 })
    ).toBe("203.0.113.9")
  })

  it("Vercel ではエッジが設定し直した先頭の値を使う", () => {
    expect(resolveClientIp("198.51.100.7", { onVercel: true, trustedHops: 1 })).toBe("198.51.100.7")
  })

  it("値が無い・段数より短いときは推測しない", () => {
    expect(resolveClientIp(null, { onVercel: false, trustedHops: 1 })).toBeNull()
    expect(resolveClientIp(" , ", { onVercel: false, trustedHops: 1 })).toBeNull()
    expect(resolveClientIp("203.0.113.9", { onVercel: false, trustedHops: 2 })).toBeNull()
  })

  it("環境変数の既定は1段で、不正な値も1段として扱う", () => {
    expect(clientIpOptionsFromEnv({})).toEqual({ onVercel: false, trustedHops: 1 })
    expect(clientIpOptionsFromEnv({ TRUSTED_PROXY_HOPS: "abc" }).trustedHops).toBe(1)
    expect(clientIpOptionsFromEnv({ TRUSTED_PROXY_HOPS: "2", VERCEL: "1" })).toEqual({
      onVercel: true,
      trustedHops: 2,
    })
  })
})
