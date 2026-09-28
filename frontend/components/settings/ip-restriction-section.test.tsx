import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

import { IpRestrictionSection, looksLikeCidr } from "@/components/settings/ip-restriction-section"

// IP 制限（#12）の設定画面

const mocks = vi.hoisted(() => ({ ipRestriction: vi.fn(), updateIpRestriction: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }))

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return { ...actual, api: { ipRestriction: mocks.ipRestriction, updateIpRestriction: mocks.updateIpRestriction } }
})
vi.mock("sonner", () => ({ toast: mocks.toast }))

describe("looksLikeCidr", () => {
  it("IPv4・IPv6・範囲を受け付け、それ以外は弾く", () => {
    expect(looksLikeCidr("203.0.113.10")).toBe(true)
    expect(looksLikeCidr("203.0.113.0/24")).toBe(true)
    expect(looksLikeCidr("2001:db8::/32")).toBe(true)
    expect(looksLikeCidr("")).toBe(false)
    expect(looksLikeCidr("example.com")).toBe(false)
  })
})

describe("IpRestrictionSection", () => {
  beforeEach(() => {
    mocks.ipRestriction.mockReset()
    mocks.updateIpRestriction.mockReset()
  })

  it("今のアクセス元を許可リストに追加して、有効にして保存できる", async () => {
    mocks.ipRestriction.mockResolvedValue({ enabled: false, entries: [], currentIp: "198.51.100.7" })
    mocks.updateIpRestriction.mockImplementation(async (input) => ({ ...input, currentIp: "198.51.100.7" }))
    render(<IpRestrictionSection />)

    await waitFor(() => expect(screen.getByText("198.51.100.7")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: "許可リストに追加" }))
    expect((screen.getByLabelText("許可するアドレス 1") as HTMLInputElement).value).toBe("198.51.100.7")

    fireEvent.click(screen.getByRole("switch"))
    fireEvent.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() =>
      expect(mocks.updateIpRestriction).toHaveBeenCalledWith({
        enabled: true,
        entries: [{ cidr: "198.51.100.7", label: "今のアクセス元" }],
      }),
    )
  })

  it("不正な値があると保存できない", async () => {
    mocks.ipRestriction.mockResolvedValue({ enabled: false, entries: [], currentIp: null })
    render(<IpRestrictionSection />)
    fireEvent.click(await screen.findByRole("button", { name: /アドレスを追加/ }))
    fireEvent.change(screen.getByLabelText("許可するアドレス 1"), { target: { value: "honsha" } })
    expect(screen.getByText(/IP アドレスか範囲/)).toBeTruthy()
    expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(true)
  })
})
