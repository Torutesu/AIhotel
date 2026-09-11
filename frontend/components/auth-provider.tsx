"use client"

// 認証コンテキスト（C-6 / X-5）
// アプリ全体にログイン状態・アクセスできるホテル一覧・選択中のホテル（Hotel）を提供する。
// 週末定義（Hotel.weekendDays）など施設ごとの設定はここで保持した hotel を唯一の出所とする（U-6）。
//
// 複数ホテルにアクセスできるユーザー（hotelId が null のユーザー、および運営）は
// ヘッダーのホテル切替で対象を変えられる。選択は URL の ?hotel= に載せて全タブで共有する（X-5）。

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { api, getAccessToken, ApiClientError, AUTH_EXPIRED_EVENT, type Hotel } from "@/lib/api"
import { useAppState } from "@/components/app-state-provider"
import type { User } from "@shared/types"

interface AuthContextValue {
  user: User | null
  hotelId: string | null
  /** 選択中のホテル。週末定義・客室数などの施設設定はこのオブジェクトを参照する（U-6） */
  hotel: Hotel | null
  /** このユーザーが実際にアクセスできるホテル（切替候補 — X-5） */
  hotels: Hotel[]
  /** ホテル切替が意味を持つか（アクセスできるホテルが2件以上） */
  canSwitchHotel: boolean
  /** ホテルを切り替える（URL の ?hotel= を更新する） */
  selectHotel: (hotelId: string) => void
  loading: boolean
  /** セッション復元に失敗したが「未ログイン」と断定できない場合のエラー（再試行可能） */
  restoreError: string | null
  /** restoreError 状態からのセッション復元の再試行 */
  retryRestore: () => void
  /** 設定タブでホテル設定を保存した後などに、保持している hotel を差し替える */
  setHotel: (hotel: Hotel) => void
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

/**
 * ユーザーがアクセスできるホテルを解決する。
 *
 * - 運営（PLATFORM_ADMIN）は全テナントの全ホテル（GET /hotels が全件を返す）
 * - hotelId が固定されているユーザーは自ホテルのみ（他ホテルは requireHotelAccess が 403）
 * - hotelId が null のユーザーは自テナントの全ホテル（GET /hotels がテナントで絞って返す）
 *
 * ADMIN も #62 以降はテナント管理者なので、GET /hotels は自テナント分しか返さない。
 * ここでロールを特別扱いせず、返ってきた一覧をそのまま候補にする。
 *
 * ホテル一覧を取得できなかった場合は /auth/me が返したホテルだけで動作させる。
 */
async function resolveHotels(user: User & { hotel?: Hotel | null }): Promise<Hotel[]> {
  try {
    const hotels = await api.hotels()
    if (user.role !== "PLATFORM_ADMIN" && user.hotelId) {
      return hotels.filter((h) => h.id === user.hotelId)
    }
    if (hotels.length > 0) return hotels
  } catch {
    // 一覧が取れなくても /auth/me のホテルで最低限は動かす（値は捏造しない）
  }
  return user.hotel ? [user.hotel] : []
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { hotelParam, setHotelParam } = useAppState()
  const [user, setUser] = useState<User | null>(null)
  const [hotels, setHotels] = useState<Hotel[]>([])
  const [loading, setLoading] = useState(true)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [restoreAttempt, setRestoreAttempt] = useState(0)

  const retryRestore = useCallback(() => {
    setRestoreError(null)
    setLoading(true)
    setRestoreAttempt((n) => n + 1)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function restore() {
      if (!getAccessToken()) {
        setLoading(false)
        return
      }
      try {
        const me = await api.me()
        const resolvedHotels = await resolveHotels(me)
        if (cancelled) return
        setUser(me)
        setHotels(resolvedHotels)
        setRestoreError(null)
      } catch (err) {
        if (cancelled) return
        // 401/403 のみ「ログアウト済み」とみなす。429・503・ネットワーク断などは
        // トークンを保持したまま再試行可能なエラー状態にする（F-2）。
        const status = err instanceof ApiClientError ? err.status : 0
        if (status === 401 || status === 403) {
          setUser(null)
          setHotels([])
          setRestoreError(null)
        } else {
          setRestoreError(
            err instanceof ApiClientError && err.message
              ? err.message
              : "セッションの確認に失敗しました",
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    restore()
    return () => {
      cancelled = true
    }
  }, [restoreAttempt])

  // リフレッシュトークンも失効した場合、lib/api.ts から通知を受けてログイン画面へ戻す（F-2）
  useEffect(() => {
    const onExpired = () => {
      setUser(null)
      setHotels([])
      setRestoreError(null)
      setLoading(false)
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.login(email, password)
    const resolvedHotels = await resolveHotels(result.user)
    setUser(result.user)
    setHotels(resolvedHotels)
    setRestoreError(null)
  }, [])

  const logout = useCallback(async () => {
    await api.logout()
    setUser(null)
    setHotels([])
    setRestoreError(null)
  }, [])

  /** URL の ?hotel= が実際にアクセスできるホテルのときだけ採用する（X-5） */
  const hotel = useMemo(() => {
    if (hotels.length === 0) return null
    const selected = hotelParam ? hotels.find((h) => h.id === hotelParam) : undefined
    if (selected) return selected
    if (user?.hotelId) {
      const own = hotels.find((h) => h.id === user.hotelId)
      if (own) return own
    }
    return hotels[0]
  }, [hotels, hotelParam, user])

  const setHotel = useCallback((next: Hotel) => {
    setHotels((prev) => {
      const index = prev.findIndex((h) => h.id === next.id)
      if (index < 0) return [...prev, next]
      const copy = [...prev]
      copy[index] = next
      return copy
    })
  }, [])

  const selectHotel = useCallback(
    (nextHotelId: string) => {
      setHotelParam(nextHotelId)
    },
    [setHotelParam],
  )

  return (
    <AuthContext.Provider
      value={{
        user,
        hotelId: hotel?.id ?? user?.hotelId ?? null,
        hotel,
        hotels,
        canSwitchHotel: hotels.length > 1,
        selectHotel,
        loading,
        restoreError,
        retryRestore,
        setHotel,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error("useAuth は AuthProvider の内側でのみ使用できます")
  }
  return ctx
}
