import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

import { ErrorBoundary } from "@/components/error-boundary"

let shouldThrow = true
function Broken() {
  if (shouldThrow) throw new Error("描画に失敗")
  return <p>復旧した画面</p>
}

describe("ErrorBoundary（#91）", () => {
  it("描画時の例外を受け止めて、その範囲だけをエラー表示にし、再試行で描画し直す", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    shouldThrow = true
    render(
      <div>
        <nav>ナビゲーション</nav>
        <ErrorBoundary>
          <Broken />
        </ErrorBoundary>
      </div>
    )

    expect(screen.getByText("ナビゲーション")).toBeTruthy()
    expect(screen.getByRole("alert")).toBeTruthy()

    shouldThrow = false
    fireEvent.click(screen.getByRole("button", { name: /再試行/ }))
    expect(screen.getByText("復旧した画面")).toBeTruthy()
  })
})
