import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"

import { TrialManagementSection, trialStatusBadge } from "./trial-management-section"
import { credentialsText } from "./trial-credentials-dialog"
import { toCreateTrialRequest } from "./trial-create-dialog"
import type { TrialSummary } from "@shared/types"

// トライアル（デモ）アカウントの管理画面（運営）

const mocks = vi.hoisted(() => ({
  trials: vi.fn(),
  trialLoginInfo: vi.fn(),
  createTrial: vi.fn(),
  updateTrial: vi.fn(),
  resetTrialPassword: vi.fn(),
  deleteTrial: vi.fn(),
}))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, api: mocks }
})
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const trial = (overrides: Partial<TrialSummary> = {}): TrialSummary => ({
  id: "t1",
  name: "○○販売店",
  kind: "DEALER",
  note: "担当 山田様",
  status: "ACTIVE",
  expiresAt: "2026-10-28T00:00:00.000Z",
  daysLeft: 30,
  purgeAt: null,
  loginEmail: "trial-0a1b2c3d@trial.example.com",
  lastLoginAt: null,
  createdAt: "2026-09-28T00:00:00.000Z",
  ...overrides,
})

describe("trialStatusBadge", () => {
  it("停止・期限切れ・期限間近（7日以内）を区別する", () => {
    expect(trialStatusBadge(trial({ status: "SUSPENDED" })).label).toBe("停止中")
    expect(trialStatusBadge(trial({ status: "EXPIRED", daysLeft: 0 }))).toEqual({ label: "期限切れ", variant: "destructive" })
    expect(trialStatusBadge(trial({ daysLeft: 5 }))).toEqual({ label: "残り5日", variant: "destructive" })
    expect(trialStatusBadge(trial({ daysLeft: 20 }))).toEqual({ label: "残り20日", variant: "secondary" })
  })
})

describe("発行フォームと案内文", () => {
  it("空欄のメモ・ログイン ID は送らない", () => {
    expect(toCreateTrialRequest({ name: " △△ホテル ", kind: "PROSPECT_HOTEL", days: 14, note: " " })).toEqual({
      name: "△△ホテル",
      kind: "PROSPECT_HOTEL",
      days: 14,
    })
  })

  it("案内文にログイン画面・ID・パスワード・期限を載せる", () => {
    const text = credentialsText({ trial: trial(), password: "Abcdefgh2345" }, "https://app.example.com")
    expect(text).toContain("https://app.example.com")
    expect(text).toContain("trial-0a1b2c3d@trial.example.com")
    expect(text).toContain("Abcdefgh2345")
    expect(text).toMatch(/2026年10月2[78]日まで/)
  })
})

describe("TrialManagementSection", () => {
  beforeEach(() => Object.values(mocks).forEach((m) => m.mockReset()))

  it("一覧を出し、延長・パスワード再発行ができる", async () => {
    mocks.trials.mockResolvedValue([trial(), trial({ id: "t2", name: "△△ホテル様", kind: "PROSPECT_HOTEL", status: "EXPIRED", daysLeft: 0, purgeAt: "2026-11-27T00:00:00.000Z" })])
    mocks.updateTrial.mockResolvedValue(trial({ expiresAt: "2026-11-27T00:00:00.000Z" }))
    mocks.resetTrialPassword.mockResolvedValue({ trial: trial(), password: "Newpass23456" })
    render(<TrialManagementSection />)

    await waitFor(() => expect(screen.getByText("○○販売店")).toBeTruthy())
    expect(screen.getByText("お客様")).toBeTruthy()
    expect(screen.getByText("期限切れ")).toBeTruthy()
    expect(screen.getByText(/自動削除/)).toBeTruthy()

    const firstRow = screen.getByText("○○販売店").closest("tr") as HTMLElement
    fireEvent.click(within(firstRow).getByRole("button", { name: /30日延長/ }))
    await waitFor(() => expect(mocks.updateTrial).toHaveBeenCalledWith("t1", { extendDays: 30 }))

    fireEvent.click(within(firstRow).getByRole("button", { name: /パスワード再発行/ }))
    fireEvent.click(await screen.findByRole("button", { name: "再発行する" }))
    await waitFor(() => expect(mocks.resetTrialPassword).toHaveBeenCalledWith("t1"))
    // 新しいパスワードはダイアログで1回だけ見せる
    expect(await screen.findByText(/Newpass23456/)).toBeTruthy()
  })

  it("一覧から同じログイン情報を再表示し、閉じるとパスワードを消す", async () => {
    mocks.trials.mockResolvedValue([trial()])
    mocks.trialLoginInfo.mockResolvedValue({ trial: trial(), password: "Test-only-pass", loginUrl: "https://public.example.test/?trial=t1", redisplayable: true })
    render(<TrialManagementSection />)
    fireEvent.click(await screen.findByRole("button", { name: "ログイン情報" }))
    expect(await screen.findByText(/Test-only-pass/)).toHaveTextContent("https://public.example.test/?trial=t1")
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }))
    expect(screen.queryByText(/Test-only-pass/)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "ログイン情報" }))
    expect(await screen.findByText(/Test-only-pass/)).toBeTruthy()
    expect(mocks.resetTrialPassword).not.toHaveBeenCalled()
  })

  it("取得に失敗したらエラーと再試行を出す", async () => {
    mocks.trials.mockRejectedValue(new Error("network"))
    render(<TrialManagementSection />)
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
  })
})
