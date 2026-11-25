import { render, screen } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
const state = vi.hoisted(() => ({ role: "ADMIN" as string | null, api: vi.fn() }))
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ user: state.role ? { role: state.role } : null, loading: false }) }))
vi.mock("@/components/login-form", () => ({ LoginForm: () => <div>ログインしてください</div> }))
vi.mock("@/hooks/use-api-query", () => ({ useApiQuery: state.api }))
import { OperationsConsole } from "./operations-console"
describe("運営画面の権限境界", () => {
  it.each(["ADMIN", "MANAGER", "OPERATOR"])("%s は運営データを取得しない", role => {
    state.role = role
    render(<OperationsConsole />)
    expect(screen.getByText("このページにはアクセスできません")).toBeInTheDocument()
    expect(state.api).not.toHaveBeenCalled()
  })
  it("未認証ではログインだけを表示する", () => {
    state.role = null
    render(<OperationsConsole />)
    expect(screen.getByText("ログインしてください")).toBeInTheDocument()
    expect(state.api).not.toHaveBeenCalled()
  })
})
