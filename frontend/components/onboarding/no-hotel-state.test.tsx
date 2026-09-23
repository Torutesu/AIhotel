import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import { NoHotelState } from "@/components/onboarding/no-hotel-state"

const mocks = vi.hoisted(() => ({
  role: "ADMIN" as string,
  createHotel: vi.fn(),
  reloadHotels: vi.fn(),
  selectHotel: vi.fn(),
}))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, api: { createHotel: mocks.createHotel } }
})

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({
    user: { name: "テスト", role: mocks.role },
    logout: vi.fn(),
    reloadHotels: mocks.reloadHotels,
    selectHotel: mocks.selectHotel,
  }),
}))

// 運営の分岐で描画されるテナント管理は別途 API を呼ぶため、ここでは差し替える
vi.mock("@/components/settings/tenant-management-section", () => ({
  TenantManagementSection: () => <div>テナント管理（差し替え）</div>,
}))

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

describe("NoHotelState（ホテル0件の初期設定 — #81）", () => {
  beforeEach(() => {
    mocks.role = "ADMIN"
    mocks.createHotel.mockReset()
    mocks.reloadHotels.mockReset()
    mocks.selectHotel.mockReset()
  })

  it("管理者はその場で最初のホテルを作成でき、作成したホテルに切り替わる", async () => {
    mocks.createHotel.mockResolvedValue({ id: "hotel-new", name: "新ホテル" })
    render(<NoHotelState />)

    fireEvent.change(screen.getByLabelText("ホテル名"), { target: { value: "新ホテル" } })
    fireEvent.change(screen.getByLabelText("客室数"), { target: { value: "80" } })
    fireEvent.click(screen.getByRole("button", { name: /ホテルを作成/ }))

    await waitFor(() =>
      expect(mocks.createHotel).toHaveBeenCalledWith({ name: "新ホテル", totalRooms: 80, address: undefined })
    )
    await waitFor(() => expect(mocks.selectHotel).toHaveBeenCalledWith("hotel-new"))
    expect(mocks.reloadHotels).toHaveBeenCalled()
  })

  it("客室数が無いと作成しない", async () => {
    render(<NoHotelState />)
    fireEvent.change(screen.getByLabelText("ホテル名"), { target: { value: "新ホテル" } })
    fireEvent.click(screen.getByRole("button", { name: /ホテルを作成/ }))
    await waitFor(() => expect(screen.getByText(/客室数/, { selector: "p[role=alert]" })).toBeTruthy())
    expect(mocks.createHotel).not.toHaveBeenCalled()
  })

  it("マネージャー・オペレーターには作成フォームを出さず、管理者への依頼を案内する", () => {
    mocks.role = "OPERATOR"
    render(<NoHotelState />)
    expect(screen.getByText("利用できるホテルがありません")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /ホテルを作成/ })).toBeNull()
  })

  it("運営にはテナント管理を出す", () => {
    mocks.role = "PLATFORM_ADMIN"
    render(<NoHotelState />)
    expect(screen.getByText("テナント管理（差し替え）")).toBeTruthy()
  })
})
