"use client"

// 初期設定のチェックリスト（#13）。必須項目が揃うまでダッシュボードの上部に出す。
// すべて揃ったら何も表示しない（任意項目だけが残っていても出さない）。

import { CheckCircle2, Circle, ClipboardList } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { useAppState } from "@/components/app-state-provider"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, type SetupStatus } from "@/lib/api"

export function SetupChecklistCard() {
  const { hotelId } = useAuth()
  const { setTab } = useAppState()

  const { data: status, error, reload } = useApiQuery<SetupStatus>(
    hotelId ? () => api.hotelSetupStatus(hotelId) : null,
    [hotelId],
    "初期設定の状況を取得できませんでした",
  )

  if (error) return <ErrorState message={error} onRetry={reload} />
  if (!status || status.ready) return null

  const required = status.items.filter((i) => i.required)
  const doneCount = required.filter((i) => i.done).length
  const percent = Math.round((doneCount / required.length) * 100)

  return (
    <Card className="border-warning/50">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base font-medium">
              <ClipboardList className="h-4 w-4" aria-hidden />
              初期設定が完了していません（{doneCount}/{required.length}）
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              必須項目が揃うまで、AIの予測・推奨は参考値としてご覧ください。
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setTab("settings")}>
            設定タブを開く
          </Button>
        </div>
        <div
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-secondary"
          role="progressbar"
          aria-label="初期設定の進み具合"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {status.items.map((item) => (
            <li key={item.key} className="flex items-start gap-2 text-sm">
              {item.done ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-positive" aria-label="完了" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label="未完了" />
              )}
              <span>
                {item.label}
                {!item.required && <span className="ml-1 text-xs text-muted-foreground">（任意）</span>}
                {!item.done && item.detail && <span className="block text-xs text-muted-foreground">{item.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
