import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import { TenantProvisionDialog, toProvisionRequest } from "@/components/settings/tenant-provision-dialog"

const mocks = vi.hoisted(() => ({ provisionTenant: vi.fn() }))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, api: { provisionTenant: mocks.provisionTenant } }
})
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// Radix の Checkbox（週末の曜日）は jsdom に無い ResizeObserver を使う
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

const RESULT = {
  tenant: { id: "t1", name: "藤田観光", code: "fujita" },
  hotel: { id: "h1", name: "ホテルA" },
  admin: { id: "u1", email: "admin@example.com", name: "山田" },
}

function fill() {
  const set = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
  set("テナント名", "藤田観光")
  set("コード", "fujita")
  set("氏名", "山田")
  set("メールアドレス", "admin@example.com")
  set("ホテル名", "ホテルA")
  set("客室数", "120")
}

describe("TenantProvisionDialog（D-13）", () => {
  beforeEach(() => mocks.provisionTenant.mockReset())

  it("メールで送れなかったときだけ、初回のパスワードを1回だけ出し、閉じたら消す", async () => {
    mocks.provisionTenant.mockResolvedValue({ ...RESULT, emailSent: false, temporaryPassword: "Tmp-Pass-1234" })
    const onOpenChange = vi.fn()
    const onProvisioned = vi.fn()
    const { rerender } = render(<TenantProvisionDialog open onOpenChange={onOpenChange} onProvisioned={onProvisioned} />)
    fill()
    fireEvent.click(screen.getByRole("button", { name: "立ち上げる" }))
    expect(await screen.findByText("テナントを立ち上げました")).toBeTruthy()
    expect(screen.getByLabelText("初回のパスワード").textContent).toBe("Tmp-Pass-1234")
    expect(screen.getByText(/この画面を閉じると再表示できません/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "コピー" })).toBeTruthy()
    expect(onProvisioned).toHaveBeenCalled()
    expect(mocks.provisionTenant).toHaveBeenCalledWith({
      tenant: { name: "藤田観光", code: "fujita" },
      admin: { email: "admin@example.com", name: "山田" },
      hotel: { name: "ホテルA", totalRooms: 120, hotelType: null, prefectureCode: null, openedOn: null, saleOpenDaysBefore: null, weekendDays: [5, 6] },
    })

    fireEvent.click(screen.getByRole("button", { name: "閉じる" }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    rerender(<TenantProvisionDialog open onOpenChange={onOpenChange} />)
    expect(screen.queryByText("Tmp-Pass-1234")).toBeNull()
    expect(screen.getByRole("button", { name: "立ち上げる" })).toBeTruthy()
  })

  it("メールで送れたらパスワードは出さない", async () => {
    mocks.provisionTenant.mockResolvedValue({ ...RESULT, emailSent: true, temporaryPassword: null })
    render(<TenantProvisionDialog open onOpenChange={vi.fn()} />)
    fill()
    fireEvent.click(screen.getByRole("button", { name: "立ち上げる" }))
    expect(await screen.findByText("管理者にログインの案内をメールで送りました。")).toBeTruthy()
    expect(screen.queryByLabelText("初回のパスワード")).toBeNull()
  })

  it("入力の誤りは送らずに項目の下に出す", async () => {
    render(<TenantProvisionDialog open onOpenChange={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "立ち上げる" }))
    await waitFor(() => expect(screen.getByText("テナント名を入力してください")).toBeTruthy())
    expect(screen.getByText("客室数は1以上の整数で入力してください")).toBeTruthy()
    expect(mocks.provisionTenant).not.toHaveBeenCalled()
  })

  it("任意の項目は入れたときだけ値にする", () => {
    const req = toProvisionRequest(
      {
        tenantName: "a", tenantCode: "abc", adminName: "b", adminEmail: "b@example.com", hotelName: "c", totalRooms: "50",
        hotelType: "RYOKAN", prefectureCode: "13", openedOn: "2026-04-01", saleOpenDaysBefore: "330",
      },
      [6],
    )
    expect(req.hotel).toEqual({
      name: "c", totalRooms: 50, hotelType: "RYOKAN", prefectureCode: "13", openedOn: "2026-04-01", saleOpenDaysBefore: 330, weekendDays: [6],
    })
  })
})
