"use client"

// アラートの状態操作（X-4 / N-4）
//
// PATCH /dashboard/alerts/:id を呼ぶ共通ボタン。ダッシュボード（Level 5・4）と
// 分析タブ（Level 1〜3）の両方から使う。
//  - 「確認済みにする」: 全ロール（現場が気づいた記録なので OPERATOR も実行できる）
//  - 「解決済みにする」: MANAGER 以上（一覧から外す判断のため）
// 楽観更新はせず、成功後に呼び出し元へ再取得を依頼する（表示と実データを乖離させない）。

import { useState } from "react"
import { Check, CheckCheck, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { useAuth } from "@/components/auth-provider"
import { api, ApiClientError, type AlertItem } from "@/lib/api"

interface AlertActionsProps {
  alert: AlertItem
  /** 状態変更に成功したら呼ばれる（呼び出し元で再取得する） */
  onUpdated: () => void
}

export function AlertActions({ alert, onUpdated }: AlertActionsProps) {
  const { hotelId, user } = useAuth()
  const canResolve = user?.role === "ADMIN" || user?.role === "MANAGER"
  const [pending, setPending] = useState<"ACKNOWLEDGED" | "RESOLVED" | null>(null)

  const acknowledged = alert.status === "ACKNOWLEDGED"

  const update = async (status: "ACKNOWLEDGED" | "RESOLVED") => {
    if (!hotelId) return
    setPending(status)
    try {
      await api.updateAlertStatus(alert.id, hotelId, status)
      toast.success(status === "RESOLVED" ? "アラートを解決済みにしました" : "アラートを確認済みにしました")
      onUpdated()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "アラートの更新に失敗しました")
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {acknowledged && (
        <span className="rounded-full border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          確認済み
        </span>
      )}
      {!acknowledged && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={pending !== null || !hotelId}
          onClick={() => void update("ACKNOWLEDGED")}
        >
          {pending === "ACKNOWLEDGED" ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          ) : (
            <Check className="h-3 w-3" aria-hidden />
          )}
          確認済みにする
        </Button>
      )}
      {canResolve && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={pending !== null || !hotelId}
          onClick={() => void update("RESOLVED")}
        >
          {pending === "RESOLVED" ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          ) : (
            <CheckCheck className="h-3 w-3" aria-hidden />
          )}
          解決済みにする
        </Button>
      )}
    </div>
  )
}
