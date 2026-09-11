import { describe, it, expect, vi, beforeEach } from "vitest"
import { act, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"

import { ApiClientError, AUTH_EXPIRED_EVENT, type Hotel } from "@/lib/api"
import { AuthProvider, useAuth } from "@/components/auth-provider"

// URL 同期（next/navigation 依存）は認証の関心事ではないので差し替える
vi.mock("@/components/app-state-provider", () => ({
  useAppState: () => ({ hotelParam: null, setHotelParam: vi.fn() }),
}))

// api クライアント本体はモックし、例外クラス・イベント名は実物を使う。
// vi.mock はファイル先頭へ巻き上げられるため、参照する値は vi.hoisted で用意する。
const mocks = vi.hoisted(() => ({
  api: {
    me: vi.fn(),
    hotels: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  },
  accessToken: { current: null as string | null },
}))
const mockApi = mocks.api

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    api: mocks.api,
    getAccessToken: () => mocks.accessToken.current,
  }
})

const HOTEL_A: Hotel = {
  id: "hotel-a",
  tenantId: "tenant-a",
  name: "テストホテルA",
  totalRooms: 100,
  weekendDays: [5, 6],
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
} as Hotel

const HOTEL_B: Hotel = { ...HOTEL_A, id: "hotel-b", name: "テストホテルB" }

const USER = {
  id: "u1",
  tenantId: "tenant-a",
  hotelId: "hotel-a",
  email: "manager@example.com",
  name: "テストマネージャー",
  role: "MANAGER",
}

/** コンテキストの中身を DOM に出すだけの確認用コンポーネント */
function AuthProbe() {
  const { user, hotel, hotels, loading, restoreError, canSwitchHotel, login, logout } = useAuth()
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user?.email ?? "なし"}</span>
      <span data-testid="hotel">{hotel?.name ?? "なし"}</span>
      <span data-testid="hotels">{hotels.length}</span>
      <span data-testid="can-switch">{String(canSwitchHotel)}</span>
      <span data-testid="restore-error">{restoreError ?? "なし"}</span>
      <button onClick={() => login("manager@example.com", "Admin1234")}>ログイン</button>
      <button onClick={() => logout()}>ログアウト</button>
    </div>
  )
}

function renderAuth(children: ReactNode = <AuthProbe />) {
  return render(<AuthProvider>{children}</AuthProvider>)
}

describe("AuthProvider", () => {
  beforeEach(() => {
    mocks.accessToken.current = null
    mockApi.me.mockReset()
    mockApi.hotels.mockReset()
    mockApi.login.mockReset()
    mockApi.logout.mockReset()
  })

  it("アクセストークンが無ければ /auth/me を呼ばずに未ログインで確定する", async () => {
    renderAuth()
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"))
    expect(mockApi.me).not.toHaveBeenCalled()
    expect(screen.getByTestId("user")).toHaveTextContent("なし")
  })

  it("セッションを復元するとユーザーとホテルが読み込まれる", async () => {
    mocks.accessToken.current = "valid-token"
    mockApi.me.mockResolvedValue({ ...USER, hotel: HOTEL_A })
    mockApi.hotels.mockResolvedValue([HOTEL_A, HOTEL_B])

    renderAuth()

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent(USER.email))
    // hotelId が固定のユーザーは自ホテルだけに絞られる（他ホテルは 403 になるため）
    expect(screen.getByTestId("hotels")).toHaveTextContent("1")
    expect(screen.getByTestId("hotel")).toHaveTextContent("テストホテルA")
    expect(screen.getByTestId("can-switch")).toHaveTextContent("false")
    expect(screen.getByTestId("restore-error")).toHaveTextContent("なし")
  })

  it("401 は「ログアウト済み」として扱い、エラーを出さない", async () => {
    mocks.accessToken.current = "stale-token"
    mockApi.me.mockRejectedValue(new ApiClientError(401, "認証エラー"))

    renderAuth()

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"))
    expect(screen.getByTestId("user")).toHaveTextContent("なし")
    expect(screen.getByTestId("restore-error")).toHaveTextContent("なし")
  })

  it("401/403 以外のエラーではトークンを保持し再試行可能なエラーにする（F-2）", async () => {
    mocks.accessToken.current = "valid-token"
    mockApi.me.mockRejectedValue(new ApiClientError(503, "サービスが一時的に利用できません"))

    renderAuth()

    await waitFor(() =>
      expect(screen.getByTestId("restore-error")).toHaveTextContent(
        "サービスが一時的に利用できません"
      )
    )
    // ユーザーは未確定だがトークンは破棄されていない（再試行できる）
    expect(screen.getByTestId("user")).toHaveTextContent("なし")
    expect(mocks.accessToken.current).toBe("valid-token")
  })

  it("ネットワーク断でもトークンを捨てずエラー状態にする", async () => {
    mocks.accessToken.current = "valid-token"
    mockApi.me.mockRejectedValue(new ApiClientError(0, "バックエンドに接続できません", true))

    renderAuth()

    await waitFor(() =>
      expect(screen.getByTestId("restore-error")).toHaveTextContent("バックエンドに接続できません")
    )
    expect(mocks.accessToken.current).toBe("valid-token")
  })

  it("ログインするとユーザーとアクセス可能なホテルが設定される", async () => {
    mockApi.login.mockResolvedValue({
      user: { ...USER, hotelId: null, hotel: null },
      tokens: { accessToken: "a", refreshToken: "r" },
    })
    mockApi.hotels.mockResolvedValue([HOTEL_A, HOTEL_B])

    renderAuth()
    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"))

    await act(async () => {
      screen.getByText("ログイン").click()
    })

    expect(mockApi.login).toHaveBeenCalledWith("manager@example.com", "Admin1234")
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent(USER.email))
    // hotelId を持たないユーザーは自テナントの全ホテルを切り替えられる（X-5）
    expect(screen.getByTestId("hotels")).toHaveTextContent("2")
    expect(screen.getByTestId("can-switch")).toHaveTextContent("true")
  })

  it("ホテル一覧が取れなくても /auth/me のホテルだけで動作する（値を捏造しない）", async () => {
    mocks.accessToken.current = "valid-token"
    mockApi.me.mockResolvedValue({ ...USER, hotel: HOTEL_A })
    mockApi.hotels.mockRejectedValue(new ApiClientError(500, "取得に失敗しました"))

    renderAuth()

    await waitFor(() => expect(screen.getByTestId("hotel")).toHaveTextContent("テストホテルA"))
    expect(screen.getByTestId("hotels")).toHaveTextContent("1")
  })

  it("auth:expired を受け取るとユーザーを破棄してログイン画面へ戻す（F-2）", async () => {
    mocks.accessToken.current = "valid-token"
    mockApi.me.mockResolvedValue({ ...USER, hotel: HOTEL_A })
    mockApi.hotels.mockResolvedValue([HOTEL_A])

    renderAuth()
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent(USER.email))

    act(() => {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT))
    })

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("なし"))
    expect(screen.getByTestId("hotels")).toHaveTextContent("0")
    expect(screen.getByTestId("loading")).toHaveTextContent("false")
  })

  it("ログアウトするとユーザーとホテルが空になる", async () => {
    mocks.accessToken.current = "valid-token"
    mockApi.me.mockResolvedValue({ ...USER, hotel: HOTEL_A })
    mockApi.hotels.mockResolvedValue([HOTEL_A])
    mockApi.logout.mockResolvedValue(undefined)

    renderAuth()
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent(USER.email))

    await act(async () => {
      screen.getByText("ログアウト").click()
    })

    expect(mockApi.logout).toHaveBeenCalled()
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("なし"))
  })

  it("AuthProvider の外で useAuth を使うと例外になる", () => {
    // React が投げるエラーのコンソール出力を抑制する
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => render(<AuthProbe />)).toThrow("AuthProvider の内側")
    spy.mockRestore()
  })
})
