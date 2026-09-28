"use client"

// トライアル（デモ）のユーザーに、残り日数を画面上部で知らせる。
// 期限を過ぎるとバックエンドが 401 を返すため、ここでは表示だけを行う。

import { Clock } from "lucide-react"
import { useAuth } from "@/components/auth-provider"

const DAY_MS = 86_400_000

export function trialDaysLeft(expiresAt: string, now: number = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / DAY_MS))
}

export function TrialBanner() {
  const { user } = useAuth()
  const expiresAt = user?.trial?.expiresAt
  if (!expiresAt) return null

  const daysLeft = trialDaysLeft(expiresAt)
  const date = new Date(expiresAt).toLocaleDateString("ja-JP", { month: "long", day: "numeric" })
  const soon = daysLeft <= 7

  return (
    <div
      role="status"
      className={
        "flex items-center justify-center gap-2 border-b px-4 py-2 text-xs " +
        (soon ? "border-warning/50 bg-warning/10 text-foreground" : "border-border bg-muted text-muted-foreground")
      }
    >
      <Clock className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
      <span>
        トライアル版です（{date}まで・残り{daysLeft}日）。表示しているホテルとデータはデモ用のサンプルです。
      </span>
    </div>
  )
}
