import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

import { ForecastReadinessCard } from "@/components/onboarding/forecast-readiness-card"
import type { ForecastReadiness } from "@/lib/api"

const mocks = vi.hoisted(() => ({
  forecastReadiness: vi.fn(),
  auth: { hotelId: "h1", user: null as null | { trial: { expiresAt: string } | null } },
}))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, api: { forecastReadiness: mocks.forecastReadiness } }
})
vi.mock("@/components/auth-provider", () => ({ useAuth: () => mocks.auth }))

const readiness = (over: Partial<ForecastReadiness> = {}): ForecastReadiness => ({
  hotelId: "h1",
  mode: "coldStart",
  summary: "実績が 12 日分のため、ホテルタイプの典型で予測しています。",
  historyDays: 12,
  openedOn: "2026-10-01",
  capabilities: [
    { key: "dayType", label: "日のタイプ", status: "inactive", detail: "実績が28日分たまると作ります" },
    { key: "coldStart", label: "典型の入り方での予測", status: "active", detail: "宿泊特化の典型を使っています" },
    { key: "weather", label: "天気", status: "limited", detail: "予報区を都道府県から決めています" },
  ],
  ...over,
})

describe("ForecastReadinessCard（D-13）", () => {
  beforeEach(() => {
    mocks.forecastReadiness.mockReset()
    mocks.auth.user = null
  })

  it("mode のバッジ・説明・機能ごとの状態と詳細を出す", async () => {
    mocks.forecastReadiness.mockResolvedValue(readiness())
    render(<ForecastReadinessCard />)
    expect(await screen.findByText("実績が少ない")).toBeTruthy()
    expect(screen.getByText("実績が 12 日分のため、ホテルタイプの典型で予測しています。")).toBeTruthy()
    expect(screen.getByText("未稼働")).toBeTruthy()
    expect(screen.getByText("稼働中")).toBeTruthy()
    expect(screen.getByText("一部")).toBeTruthy()
    expect(screen.getByText("実績が28日分たまると作ります")).toBeTruthy()
    expect(screen.getByText(/開業日 2026-10-01/)).toBeTruthy()
    expect(mocks.forecastReadiness).toHaveBeenCalledWith("h1")
  })

  it("学習中・準備完了のラベル。設定タブ（hideWhenFull なし）は準備完了でも出す", async () => {
    mocks.forecastReadiness.mockResolvedValue(readiness({ mode: "full" }))
    render(<ForecastReadinessCard />)
    expect(await screen.findByText("準備完了")).toBeTruthy()
  })

  it("ダッシュボード（hideWhenFull）は準備完了なら何も出さず、学習中なら出す", async () => {
    mocks.forecastReadiness.mockResolvedValue(readiness({ mode: "full" }))
    const { container, unmount } = render(<ForecastReadinessCard hideWhenFull />)
    await vi.waitFor(() => expect(mocks.forecastReadiness).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(container.textContent).toBe("")
    unmount()

    mocks.forecastReadiness.mockResolvedValue(readiness({ mode: "learning" }))
    render(<ForecastReadinessCard hideWhenFull />)
    expect(await screen.findByText("学習中")).toBeTruthy()
  })

  it("ダッシュボードではトライアルのユーザーに出さず、取りにも行かない", () => {
    mocks.auth.user = { trial: { expiresAt: "2026-12-01T00:00:00.000Z" } }
    const { container } = render(<ForecastReadinessCard hideWhenFull />)
    expect(container.textContent).toBe("")
    expect(mocks.forecastReadiness).not.toHaveBeenCalled()
  })

  it("取得に失敗したらエラーと再試行を出す", async () => {
    mocks.forecastReadiness.mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce(readiness({ mode: "learning" }))
    render(<ForecastReadinessCard />)
    expect(await screen.findByText("予測の準備状況を取得できませんでした")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "再試行" }))
    expect(await screen.findByText("学習中")).toBeTruthy()
  })
})
