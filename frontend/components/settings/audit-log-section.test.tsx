import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import { AuditLogSection } from "@/components/settings/audit-log-section"

const mocks = vi.hoisted(() => ({ auditLogs: vi.fn() }))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, api: { auditLogs: mocks.auditLogs } }
})
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ hotelId: "hotel-a" }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const row = (id: string, action: string) => ({
  id,
  action,
  entity: "User",
  entityId: null,
  oldValue: null,
  newValue: null,
  ipAddress: "203.0.113.9",
  createdAt: "2026-09-23T01:00:00.000Z",
  user: { name: "山田", email: "yamada@example.com" },
})

describe("AuditLogSection（#89）", () => {
  beforeEach(() => mocks.auditLogs.mockReset())

  it("操作を日本語で表示し、続きのページを読み込める", async () => {
    mocks.auditLogs
      .mockResolvedValueOnce({ items: [row("1", "LOGIN_FAILED")], nextCursor: "1" })
      .mockResolvedValueOnce({ items: [row("2", "PASSWORD_RESET")], nextCursor: null })
    render(<AuditLogSection />)

    await waitFor(() => expect(screen.getByText("ログイン失敗")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: /さらに読み込む/ }))
    await waitFor(() => expect(screen.getByText("一時パスワードの発行")).toBeTruthy())
    expect(mocks.auditLogs).toHaveBeenLastCalledWith(expect.objectContaining({ hotelId: "hotel-a", cursor: "1" }))
    expect(screen.queryByRole("button", { name: /さらに読み込む/ })).toBeNull()
  })
})
