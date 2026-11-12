import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

import { ChatInterface } from "./chat-interface"
import { ApiClientError } from "@/lib/api"

// AI チャット（D-13 — POST /api/v1/chat。定型のサンプルの答えはデモモードだけ）

const chat = vi.fn()
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ hotelId: "h1" }) }))
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: { chat: (...a: unknown[]) => chat(...a) },
}))

function ask(text: string) {
  fireEvent.change(screen.getByPlaceholderText("質問を入力してください..."), { target: { value: text } })
  fireEvent.click(screen.getByLabelText("メッセージを送信"))
}

describe("ChatInterface", () => {
  beforeEach(() => chat.mockReset())

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
})
