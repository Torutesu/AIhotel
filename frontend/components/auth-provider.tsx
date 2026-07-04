"use client"

// 認証コンテキスト（C-6）
// アプリ全体にログイン状態・所属ホテルIDを提供する。

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import { api, getAccessToken } from "@/lib/api"
import type { User } from "@shared/types"

interface AuthContextValue {
  user: User | null
  hotelId: string | null
  loading: boolean
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
      } catch {
        if (cancelled) return
        setUser(null)
        setHotelId(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    restore()
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.login(email, password)
    const resolvedHotelId = await resolveHotelId(result.user)
    setUser(result.user)
    setHotelId(resolvedHotelId)
  }, [])

  const logout = useCallback(async () => {
    await api.logout()
    setUser(null)
    setHotelId(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, hotelId, loading, login, logout }}>
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
