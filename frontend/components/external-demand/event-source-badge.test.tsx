import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"

import { EventSourceBadge, safeExternalUrl } from "@/components/external-demand/event-source-badge"

describe("EventSourceBadge（D-13）", () => {
  it("エージェントが集めたイベントに「AI収集」と根拠のリンク（新しいタブ・noopener）を出す", () => {
    render(<EventSourceBadge event={{ name: "港まつり", source: "agent", sourceUrl: "https://example.com/festival" }} />)
    expect(screen.getByText("AI収集")).toBeTruthy()
    const link = screen.getByRole("link", { name: "「港まつり」の根拠のページを新しいタブで開く" })
    expect(link.getAttribute("href")).toBe("https://example.com/festival")
    expect(link.getAttribute("target")).toBe("_blank")
    expect(link.getAttribute("rel")).toBe("noopener noreferrer")
  })

  it("人が登録したイベントには何も出さない。http(s) 以外の URL はリンクにしない", () => {
    const { container } = render(<EventSourceBadge event={{ name: "a", source: "manual", sourceUrl: "https://example.com" }} />)
    expect(container.textContent).toBe("")
    render(<EventSourceBadge event={{ name: "b", source: "agent", sourceUrl: "javascript:alert(1)" }} />)
    expect(screen.getByText("AI収集")).toBeTruthy()
    expect(screen.queryByRole("link")).toBeNull()
    expect(safeExternalUrl(null)).toBeNull()
    expect(safeExternalUrl("not a url")).toBeNull()
  })
})
