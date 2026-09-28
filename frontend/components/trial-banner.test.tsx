import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

import { TrialBanner, trialDaysLeft } from "@/components/trial-banner"

const auth = vi.hoisted(() => ({ user: null as null | { trial?: { expiresAt: string } | null } }))
vi.mock("@/components/auth-provider", () => ({ useAuth: () => auth }))

describe("TrialBanner", () => {
  it("残り日数は切り上げ、期限を過ぎたら0", () => {
    const now = Date.parse("2026-09-28T00:00:00Z")
    expect(trialDaysLeft("2026-10-28T00:00:00Z", now)).toBe(30)
    expect(trialDaysLeft("2026-09-28T01:00:00Z", now)).toBe(1)
    expect(trialDaysLeft("2026-09-27T00:00:00Z", now)).toBe(0)
  })

  it("トライアルのユーザーにだけ出す", () => {
    auth.user = { trial: null }
    const { container, rerender } = render(<TrialBanner />)
    expect(container.textContent).toBe("")

    auth.user = { trial: { expiresAt: new Date(Date.now() + 10 * 86_400_000).toISOString() } }
    rerender(<TrialBanner />)
    expect(screen.getByRole("status").textContent).toContain("残り10日")
  })
})
