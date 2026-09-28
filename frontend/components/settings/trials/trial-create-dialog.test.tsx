import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TrialCreateDialog, toCreateTrialRequest } from "./trial-create-dialog"

describe("トライアルの自動発行", () => {
  it("ID 入力を求めず、お客様・30日を指定して発行できる", async () => {
    const submit = vi.fn()
    render(<TrialCreateDialog open onOpenChange={vi.fn()} saving={false} onSubmit={submit} />)
    expect(screen.queryByLabelText(/ログイン ID/)).toBeNull()
    fireEvent.change(screen.getByLabelText("渡し先の名前"), { target: { value: "Demo1" } })
    fireEvent.click(screen.getByRole("radio", { name: "お客様" }))
    fireEvent.click(screen.getByRole("button", { name: "発行する" }))
    await waitFor(() => expect(submit).toHaveBeenCalledOnce())
    expect(toCreateTrialRequest(submit.mock.calls[0][0])).toEqual({ name: "Demo1", kind: "PROSPECT_HOTEL", days: 30 })
  })
})
