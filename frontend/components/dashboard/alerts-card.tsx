"use client"

// アラート一覧（U-15 で dashboard-tab.tsx から分割）
// GET /dashboard/alerts の実データ。ダッシュボードは Level 5・4 のみ表示する（F-DASH-05）。

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { resolveAlertLink, type AlertLinkTarget } from "@/lib/alert-link"
import type { AlertItem } from "@/lib/api"
import { format } from "date-fns"

interface AlertsCardProps {
  alerts: AlertItem[]
  loading: boolean
  onAlertNavigate?: (target: AlertLinkTarget) => void
}

export function AlertsCard({ alerts, loading, onAlertNavigate }: AlertsCardProps) {
  const alertLevelStyles: Record<number, { border: string; bg: string; dot: string; label: string; text: string }> = {
    5: {
      border: "border-negative",
      bg: "bg-negative/10",
      dot: "bg-negative",
      label: "Level 5 / すぐに修正する",
      text: "text-negative",
    },
    4: {
      border: "border-warning",
      bg: "bg-warning/10",
      dot: "bg-warning",
      label: "Level 4 / 1週間内での経過観察が必要",
      text: "text-warning",
    },
  }

  // level未設定の旧データはseverityから補完する
  const resolveAlertLevel = (alert: AlertItem): number =>
    alert.level ?? (alert.severity === "RED" ? 5 : 4)

  const alertStyleFor = (alert: AlertItem) => {
    const level = resolveAlertLevel(alert)
    return (
      alertLevelStyles[level] ?? {
        border: "border-border",
        bg: "bg-muted/50",
        dot: "bg-muted-foreground",
        label: `Level ${level}`,
        text: "text-muted-foreground",
      }
    )
  }

  return (
    <Card>
      <CardHeader className="pb-1">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base font-medium">アラート</CardTitle>
          <p className="text-xs text-muted-foreground">
            重要度5段階のうち Level 5・4 を表示（Level 3以下は各分析画面で確認）
          </p>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            現在、対応が必要なアラート（Level 5・4）はありません。
          </p>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => {
              const style = alertStyleFor(alert)
              const link = resolveAlertLink(alert.linkTab)
              return (
                <div key={alert.id} className={`border-l-4 ${style.border} ${style.bg} p-3 rounded-r`}>
                  <div className="flex items-start gap-2">
                    <div className={`w-3 h-3 rounded-full ${style.dot} mt-1 flex-shrink-0`}></div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`text-xs font-semibold ${style.text}`}>{style.label}</span>
                        {link && (
                          <button
                            onClick={() => onAlertNavigate?.(link)}
                            className="text-xs text-primary hover:underline hover:text-[color:var(--cyan-edge)] transition-colors"
                          >
                            {alert.targetDate ? format(new Date(alert.targetDate), "yyyy/MM/dd") : ""}
                            {` (${link.label})`}
                          </button>
                        )}
                      </div>
                      <p className={`text-sm ${style.text}`}>
                        {alert.title}: {alert.message}
                      </p>
                    </div>
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
