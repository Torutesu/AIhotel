import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import { HotelSetupToolsSection } from "@/components/settings/hotel-setup-tools-section"

const mocks = vi.hoisted(() => ({
  user: { role: "ADMIN", hotelId: null as string | null },
  integrations: vi.fn(),
  saveIntegration: vi.fn(),
  copyHotelSettings: vi.fn(),
  importSetupWorkbook: vi.fn(),
  downloadSetupWorkbook: vi.fn(),
}))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    api: {
      integrations: mocks.integrations,
      saveIntegration: mocks.saveIntegration,
      copyHotelSettings: mocks.copyHotelSettings,
      importSetupWorkbook: mocks.importSetupWorkbook,
      downloadSetupWorkbook: mocks.downloadSetupWorkbook,
    },
  }
})
vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({
    hotelId: "h1",
    user: mocks.user,
    hotels: [
      { id: "h1", tenantId: "t1", name: "本館" },
      { id: "h2", tenantId: "t1", name: "別館" },
      { id: "h9", tenantId: "t9", name: "他社ホテル" },
    ],
  }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

describe("HotelSetupToolsSection（#13）", () => {
  beforeEach(() => {
    mocks.user = { role: "ADMIN", hotelId: null }
    for (const fn of [mocks.integrations, mocks.saveIntegration, mocks.copyHotelSettings, mocks.importSetupWorkbook]) fn.mockReset()
    mocks.integrations.mockResolvedValue([])
  })

  it("連携先: 候補外の製品は「その他」で入力して保存できる", async () => {
    mocks.saveIntegration.mockImplementation(async (input) => ({ id: "i1", updatedAt: "x", ...input }))
    render(<HotelSetupToolsSection />)
    fireEvent.change(await screen.findByLabelText("製品", { selector: "#integration-PMS-product" }), { target: { value: "__other" } })
    fireEvent.change(screen.getByLabelText("PMSの製品名"), { target: { value: "自社PMS" } })
    fireEvent.click(screen.getAllByRole("button", { name: "保存" })[0])
    await waitFor(() =>
      expect(mocks.saveIntegration).toHaveBeenCalledWith(expect.objectContaining({ hotelId: "h1", kind: "PMS", product: "自社PMS", status: "PLANNED" }))
    )
  })

  it("複製元の候補は同じテナントの他のホテルだけ", async () => {
    render(<HotelSetupToolsSection />)
    const select = await screen.findByLabelText("複製元のホテル")
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.textContent)
    expect(options).toEqual(["選択してください", "別館"])
    fireEvent.change(select, { target: { value: "h2" } })
    mocks.copyHotelSettings.mockResolvedValue({ copied: { roomTypes: 2 } })
    fireEvent.click(screen.getByRole("button", { name: "複製する" }))
    await waitFor(() => expect(mocks.copyHotelSettings).toHaveBeenCalledWith("h1", "h2", ["roomTypes", "priceRanks", "strategy"]))
  })

  it("ホテルに所属する管理者・マネージャーには複製を出さない。オペレーターには一括投入も出さない", async () => {
    mocks.user = { role: "MANAGER", hotelId: "h1" }
    const { unmount } = render(<HotelSetupToolsSection />)
    await screen.findByText("連携先（PMS・サイトコントローラー）")
    expect(screen.queryByText("既存ホテルから設定を複製")).toBeNull()
    expect(screen.getByText("初期設定シート（Excel）")).toBeTruthy()
    unmount()

    mocks.user = { role: "OPERATOR", hotelId: "h1" }
    render(<HotelSetupToolsSection />)
    await screen.findByText("連携先（PMS・サイトコントローラー）")
    expect(screen.queryByText("初期設定シート（Excel）")).toBeNull()
    expect(screen.queryAllByRole("button", { name: "保存" })).toHaveLength(0)
  })

  it("シートの取り込みは確認結果を見せてから取り込み、不正な箇所はシート名と行で出す", async () => {
    const { ApiClientError } = await import("@/lib/api")
    mocks.importSetupWorkbook.mockRejectedValueOnce(
      new ApiClientError(400, "取り込めない箇所があります", false, [{ field: "部屋タイプ!4", message: "定員は1〜20の整数" }])
    )
    render(<HotelSetupToolsSection />)
    const input = await screen.findByLabelText("初期設定シートのファイル")
    fireEvent.change(input, { target: { files: [new File(["x"], "setup.xlsx")] } })
    expect(await screen.findByText("部屋タイプ の 4行目: 定員は1〜20の整数")).toBeTruthy()

    mocks.importSetupWorkbook.mockResolvedValue({
      dryRun: true,
      basicUpdated: true,
      roomTypes: { created: 1, updated: 2 },
      priceRanks: { created: 0, updated: 5 },
      competitors: { created: 3, updated: 0 },
      budgets: { created: 12, updated: 0 },
    })
    fireEvent.change(input, { target: { files: [new File(["x"], "setup.xlsx")] } })
    expect(await screen.findByText("部屋タイプ：新規 1・更新 2")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "取り込む" }))
    await waitFor(() => expect(mocks.importSetupWorkbook).toHaveBeenLastCalledWith("h1", expect.any(String), false))
  })
})
