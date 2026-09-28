import { beforeEach, describe, expect, it, vi } from "vitest"
import { decryptTrialPassword, encryptTrialPassword, trialLoginUrl } from "./credentials"

describe("配布用パスワードの暗号化", () => {
  beforeEach(() => vi.stubEnv("DEMO_TRIAL_CREDENTIALS_KEY", "b".repeat(64)))
  it("同じパスワードも毎回異なる暗号文で保存し、改ざん・他IDへの移植・異なる鍵を拒否する", () => {
    const encrypted = encryptTrialPassword("trial-a", "test-only-pass")
    expect(encrypted).not.toContain("test-only-pass")
    expect(encryptTrialPassword("trial-a", "test-only-pass")).not.toBe(encrypted)
    expect(decryptTrialPassword("trial-a", encrypted)).toBe("test-only-pass")
    expect(() => decryptTrialPassword("trial-b", encrypted)).toThrow()
    const parts = encrypted.split(".")
    parts[3] = (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1)
    expect(() => decryptTrialPassword("trial-a", parts.join("."))).toThrow()
    vi.stubEnv("DEMO_TRIAL_CREDENTIALS_KEY", "c".repeat(64))
    expect(() => decryptTrialPassword("trial-a", encrypted)).toThrow()
  })
  it("配布URL未設定では運営URLへフォールバックしない", () => {
    vi.stubEnv("DEMO_PUBLIC_URL", "")
    expect(() => trialLoginUrl("trial-a")).toThrow()
    vi.stubEnv("DEMO_PUBLIC_URL", "https://public.example.test/path?old=value#old")
    expect(trialLoginUrl("trial-a")).toBe("https://public.example.test/?trial=trial-a")
  })
})
