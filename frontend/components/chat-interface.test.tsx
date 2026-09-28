import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useRef, useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { ChatInterface } from "./chat-interface"

describe("AIチャットの操作", () => {
  it("閉じたら起動ボタンへフォーカスを戻す", async () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      const trigger = useRef<HTMLButtonElement>(null)
      return <><button ref={trigger} onClick={() => setOpen(true)}>チャットを開く</button><ChatInterface isOpen={open} onClose={() => setOpen(false)} returnFocusRef={trigger} /></>
    }
    render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: "チャットを開く" }))
    fireEvent.keyDown(document, { key: "Escape" })
    await waitFor(() => expect(screen.getByRole("button", { name: "チャットを開く" })).toHaveFocus())
  })
  it("日本語変換確定のEnterでは送信しない", () => {
    render(<ChatInterface isOpen onClose={vi.fn()} />)
    const input = screen.getByRole("textbox", { name: "AIアシスタントへの質問" })
    fireEvent.change(input, { target: { value: "稼働率を確認" } })
    fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 })
    expect(input).toHaveValue("稼働率を確認")
    expect(screen.queryByText("稼働率を確認")).not.toBeInTheDocument()
  })
  it("Escapeで閉じられ、会話にアクセシブルな名前がある", () => {
    const close = vi.fn()
    render(<ChatInterface isOpen onClose={close} />)
    expect(screen.getByRole("dialog", { name: "AIアシスタント" })).toBeInTheDocument()
    expect(screen.getByRole("log", { name: "会話履歴" })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(close).toHaveBeenCalledOnce()
  })
})
