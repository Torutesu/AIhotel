import { describe, it, expect, vi, beforeEach } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"

import { ChatInterface } from "./chat-interface"
import { ApiClientError } from "@/lib/api"

// AI チャット（D-13 — POST /api/v1/chat。定型のサンプルの答えはデモモードだけ）

const chat = vi.fn()
const auth = vi.hoisted(() => ({ hotelId: "h1" }))
vi.mock("@/components/auth-provider", () => ({ useAuth: () => auth }))
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: { chat: (...a: unknown[]) => chat(...a) },
}))

function ask(text: string) {
  fireEvent.change(screen.getByPlaceholderText("質問を入力してください..."), { target: { value: text } })
  fireEvent.click(screen.getByLabelText("メッセージを送信"))
}

describe("ChatInterface", () => {
  beforeEach(() => { chat.mockReset(); auth.hotelId = "h1" })

  it("挨拶を除いた会話を送り、AI の答えを出す", async () => {
    chat.mockResolvedValueOnce({ reply: "今月の着地見込みは予算比 95.0% です。" }).mockResolvedValueOnce({ reply: "12/5（金）です。" })
    render(<ChatInterface isOpen onClose={vi.fn()} />)
    expect(screen.queryByText(/サンプル/)).toBeNull()
    ask("今月は予算に届きそう？")
    expect(await screen.findByText("今月の着地見込みは予算比 95.0% です。")).toBeTruthy()
    expect(chat).toHaveBeenCalledWith("h1", [{ role: "user", content: "今月は予算に届きそう？" }])
    ask("上げる日は？")
    expect(await screen.findByText("12/5（金）です。")).toBeTruthy()
    expect(chat.mock.calls[1][1]).toEqual([
      { role: "user", content: "今月は予算に届きそう？" },
      { role: "assistant", content: "今月の着地見込みは予算比 95.0% です。" },
      { role: "user", content: "上げる日は？" },
    ])
  })

  it("失敗したらエラーを出し、もう一度送れる", async () => {
    chat.mockRejectedValueOnce(new ApiClientError(503, "AI チャットは使えません")).mockResolvedValueOnce({ reply: "お答えします。" })
    render(<ChatInterface isOpen onClose={vi.fn()} />)
    ask("予算は？")
    expect((await screen.findByRole("alert")).textContent).toContain("AI チャットは使えません")
    fireEvent.click(screen.getByText("もう一度送る"))
    expect(await screen.findByText("お答えします。")).toBeTruthy()
    expect(chat.mock.calls[1][1]).toEqual([{ role: "user", content: "予算は？" }])
  })
  it("質問例は送信せず、編集可能な入力欄に入れる", () => {
    render(<ChatInterface isOpen onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "来月の見通しを教えて" }))
    expect(screen.getByRole("textbox")).toHaveValue("来月の見通しを教えて")
    expect(screen.getByRole("textbox")).toHaveFocus()
    expect(chat).not.toHaveBeenCalled()
  })

  it("日本語の変換確定とShift+Enterでは送信せず、通常のEnterで送る", async () => {
    chat.mockResolvedValue({ reply: "回答" })
    render(<ChatInterface isOpen onClose={vi.fn()} />)
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "来月の予測" } })
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 })
    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true })
    expect(chat).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: "Enter" })
    expect(await screen.findByText("回答")).toBeTruthy()
    expect(chat).toHaveBeenCalledTimes(1)
  })

  it("ホテル切替前の未完了の回答と履歴を次のホテルに持ち込まない", async () => {
    let resolve!: (value: { reply: string }) => void
    chat.mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    const view = render(<ChatInterface isOpen onClose={vi.fn()} />)
    ask("ホテル1の予算")
    auth.hotelId = "h2"
    view.rerender(<ChatInterface isOpen onClose={vi.fn()} />)
    await act(async () => resolve({ reply: "ホテル1の回答" }))
    expect(screen.queryByText("ホテル1の予算")).toBeNull()
    expect(screen.queryByText("ホテル1の回答")).toBeNull()
    chat.mockResolvedValueOnce({ reply: "ホテル2の回答" })
    ask("ホテル2の予算")
    await screen.findByText("ホテル2の回答")
    expect(chat.mock.calls[1]).toEqual(["h2", [{ role: "user", content: "ホテル2の予算" }]])
  })

  it("失敗した質問を編集して送信しても履歴を重複させない", async () => {
    chat.mockRejectedValueOnce(new Error()).mockResolvedValueOnce({ reply: "回答しました" })
    render(<ChatInterface isOpen onClose={vi.fn()} />)
    ask("今月")
    await screen.findByRole("alert")
    fireEvent.click(screen.getByRole("button", { name: "質問を編集" }))
    expect(screen.getByRole("textbox")).toHaveValue("今月")
    ask("来月")
    await screen.findByText("回答しました")
    expect(chat.mock.calls[1][1]).toEqual([{ role: "user", content: "来月" }])
  })

})
