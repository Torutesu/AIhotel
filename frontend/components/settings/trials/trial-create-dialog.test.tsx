import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TrialCreateDialog, toCreateTrialRequest } from "./trial-create-dialog"

describe("トライアル発行の入力修正", () => {
  it("メール形式を修正した時点でエラーを消し、お客様として送信できる", async () => {
    const submit = vi.fn()
    render(<TrialCreateDialog open onOpenChange={vi.fn()} saving={false} onSubmit={submit} />)
    fireEvent.change(screen.getByLabelText("渡し先の名前"), { target: { value: "Demo1" } })
    fireEvent.click(screen.getByRole("radio", { name: "お客様" }))
    const email = screen.getByLabelText("ログイン ID（任意）")
    fireEvent.change(email, { target: { value: "Demo1@gmail" } })
    fireEvent.blur(email)
    expect(await screen.findByText("有効なメールアドレスを入力してください")).toBeTruthy()
    fireEvent.change(email, { target: { value: "Demo1@gmail.com" } })
    await waitFor(() => expect(screen.queryByText("有効なメールアドレスを入力してください")).toBeNull())
    fireEvent.click(screen.getByRole("button", { name: "発行する" }))
    await waitFor(() => expect(submit).toHaveBeenCalledOnce())
    expect(toCreateTrialRequest(submit.mock.calls[0][0])).toEqual({
      name: "Demo1", kind: "PROSPECT_HOTEL", days: 30, loginEmail: "demo1@gmail.com",
    })
  })
})
