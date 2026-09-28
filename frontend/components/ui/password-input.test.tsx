import { fireEvent, render, screen } from "@testing-library/react"
import { expect, it, vi } from "vitest"
import { PasswordInput } from "./password-input"

it("初期値を隠し、表示切替で値を変えず送信もしない", () => {
  const submit = vi.fn((event) => event.preventDefault())
  render(<form onSubmit={submit}><label htmlFor="test-password">テスト用パスワード</label><PasswordInput id="test-password" defaultValue="test-only-pass" /></form>)
  const input = screen.getByLabelText("テスト用パスワード")
  expect(input).toHaveAttribute("type", "password")
  fireEvent.click(screen.getByRole("button", { name: "パスワードを表示" }))
  expect(input).toHaveAttribute("type", "text")
  expect(input).toHaveValue("test-only-pass")
  expect(screen.getByRole("button", { name: "パスワードを隠す" })).toHaveAttribute("aria-pressed", "true")
  fireEvent.click(screen.getByRole("button", { name: "パスワードを隠す" }))
  expect(input).toHaveAttribute("type", "password")
  expect(submit).not.toHaveBeenCalled()
})
