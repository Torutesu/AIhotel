"use client"

// 認証コンテキスト（C-6）
// アプリ全体にログイン状態・所属ホテルIDを提供する。

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import { api, getAccessToken, ApiClientError, AUTH_EXPIRED_EVENT } from "@/lib/api"
import type { User } from "@shared/types"

interface AuthContextValue {
  user: User | null
  hotelId: string | null
  loading: boolean
  /** セッション復元に失敗したが「未ログイン」と断定できない場合のエラー（再試行可能） */
  restoreError: string | null
  /** restoreError 状態からのセッション復元の再試行 */
  retryRestore: () => void
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

async function resolveHotelId(user: User): Promise<string | null> {
  if (user.hotelId) return user.hotelId
  try {
    const hotels = await api.hotels()
    return hotels[0]?.id ?? null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [hotelId, setHotelId] = useState<string | null>(null)
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
        const resolvedHotelId = await resolveHotelId(me)
        if (cancelled) return
        setUser(me)
        setHotelId(resolvedHotelId)
        setRestoreError(null)
      } catch (err) {
        if (cancelled) return
        // 401/403 のみ「ログアウト済み」とみなす。429・503・ネットワーク断などは
        // トークンを保持したまま再試行可能なエラー状態にする（F-2）。
        const status = err instanceof ApiClientError ? err.status : 0
        if (status === 401 || status === 403) {
          setUser(null)
          setHotelId(null)
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
      setHotelId(null)
      setRestoreError(null)
      setLoading(false)
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.login(email, password)
    const resolvedHotelId = await resolveHotelId(result.user)
    setUser(result.user)
    setHotelId(resolvedHotelId)
    setRestoreError(null)
  }, [])

  const logout = useCallback(async () => {
    await api.logout()
    setUser(null)
    setHotelId(null)
    setRestoreError(null)
  }, [])

  return (
    <AuthContext.Provider
      value={{ user, hotelId, loading, restoreError, retryRestore, login, logout }}
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
