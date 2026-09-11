"use client"

// Level 1〜3 のアラート一覧（X-4 / F-DASH-05）
//
// ダッシュボードは Level 5・4 のみを表示し「Level 3以下は各分析画面で確認」と案内しているが、
// それを表示する画面が無かったため分析タブに用意する。
// GET /dashboard/alerts?minLevel=1 を取得し、Level 3以下だけを表示する
// （Level 5・4 はダッシュボードの担当なのでここでは重複させない）。

import { useCallback, useEffect, useState } from "react"
import { format } from "date-fns"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertActions } from "@/components/alert-actions"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { api, ApiClientError, type AlertItem } from "@/lib/api"

/** 分析タブで扱うアラートの上限レベル（Level 5・4 はダッシュボードの担当） */
const MAX_ANALYSIS_ALERT_LEVEL = 3

const LEVEL_LABELS: Record<number, string> = {
  3: "Level 3 / 傾向の確認",
  2: "Level 2 / 参考情報",
  1: "Level 1 / 記録のみ",
}

/** level 未設定の旧データは severity から補完する（アラートカードと同じ扱い） */
function resolveLevel(alert: AlertItem): number {
  return alert.level ?? (alert.severity === "RED" ? 5 : 4)
}

export function LowAlertsSection() {
  const { hotelId } = useAuth()
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!hotelId) return
    setLoading(true)
    setError(null)
    try {
      const all = await api.alerts(hotelId, 1)
      setAlerts(all.filter((a) => resolveLevel(a) <= MAX_ANALYSIS_ALERT_LEVEL))
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "アラートの取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId])

  useEffect(() => {
    load()
  }, [load])

  return (
    <Card>
      <CardHeader className="pb-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base font-medium">アラート（Level 3以下）</CardTitle>
          <p className="text-xs text-muted-foreground">
            ダッシュボードに出ない Level 3・2・1 をここで確認します
          </p>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Level 3以下の未解決アラートはありません。
          </p>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => {
              const level = resolveLevel(alert)
              return (
                <div
                  key={alert.id}
                  className="rounded-r border-l-4 border-border bg-muted/40 p-3"
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-muted-foreground">
                      {LEVEL_LABELS[level] ?? `Level ${level}`}
                    </span>
                    {alert.targetDate && (
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(alert.targetDate), "yyyy/MM/dd")}
                      </span>
                    )}
                  </div>
                  <p className="text-sm">
                    {alert.title}: {alert.message}
                  </p>
                  <div className="mt-2">
                    <AlertActions alert={alert} onUpdated={() => void load()} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
