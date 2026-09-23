import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import { PasswordChangeForm } from "@/components/settings/password-change-form"

const mocks = vi.hoisted(() => ({ changePassword: vi.fn(), replaceUser: vi.fn() }))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, api: { changePassword: mocks.changePassword } }
})
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ replaceUser: mocks.replaceUser }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function fill(current: string, next: string, confirm: string) {
  fireEvent.change(screen.getByLabelText("現在のパスワード"), { target: { value: current } })
  fireEvent.change(screen.getByLabelText("新しいパスワード"), { target: { value: next } })
  fireEvent.change(screen.getByLabelText("新しいパスワード（確認）"), { target: { value: confirm } })
  fireEvent.click(screen.getByRole("button", { name: /パスワードを変更/ }))
}

describe("PasswordChangeForm（#89）", () => {
  beforeEach(() => {
    mocks.changePassword.mockReset()
    mocks.replaceUser.mockReset()
  })

  it("確認用が一致しなければ送信しない", async () => {
    render(<PasswordChangeForm />)
    fill("Old12345", "NewPass123", "NewPass124")
    await waitFor(() => expect(screen.getByText("確認用のパスワードが一致しません")).toBeTruthy())
    expect(mocks.changePassword).not.toHaveBeenCalled()
  })

  it("変更に成功したらログインユーザーを差し替える（変更待ちの解除とホテルの再取得）", async () => {
    mocks.changePassword.mockResolvedValue({ id: "u1", mustChangePassword: false })
    render(<PasswordChangeForm />)
    fill("Old12345", "NewPass123", "NewPass123")
    await waitFor(() => expect(mocks.replaceUser).toHaveBeenCalledWith({ id: "u1", mustChangePassword: false }))
    expect(mocks.changePassword).toHaveBeenCalledWith("Old12345", "NewPass123")
  })

  it("現在のパスワードの誤りは項目の下に出す", async () => {
    const { ApiClientError } = await import("@/lib/api")
    mocks.changePassword.mockRejectedValue(
      new ApiClientError(400, "現在のパスワードが正しくありません", false, [
        { field: "currentPassword", message: "現在のパスワードが正しくありません" },
      ])
    )
    render(<PasswordChangeForm />)
    fill("Wrong123", "NewPass123", "NewPass123")
    await waitFor(() => expect(screen.getByText("現在のパスワードが正しくありません")).toBeTruthy())
    expect(mocks.replaceUser).not.toHaveBeenCalled()
  })
})
