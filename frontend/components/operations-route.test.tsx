import { afterEach, describe, expect, it, vi } from "vitest"
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404") } }))
vi.mock("@/components/operations-console", () => ({ OperationsConsole: () => null }))
vi.mock("@/components/auth-provider", () => ({ AuthProvider: () => null }))
vi.mock("@/components/app-state-provider", () => ({ AppStateProvider: () => null }))
import OperationsPage from "@/app/operations/page"
afterEach(() => vi.unstubAllEnvs())
describe("運営画面の公開範囲", () => {
  it.each([undefined, "false"])("外部配布環境では404 (%s)", value => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_ADMIN_CONSOLE", value)
    expect(() => OperationsPage()).toThrow("404")
  })
  it("専用環境だけで認証画面を提供する", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_ADMIN_CONSOLE", "true")
    expect(() => OperationsPage()).not.toThrow()
  })
})
