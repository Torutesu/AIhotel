"use client"

// アラート一覧（U-15 で dashboard-tab.tsx から分割）
// GET /dashboard/alerts の実データ。ダッシュボードは Level 5・4 のみ表示する（F-DASH-05）。
// 各カードから PATCH /dashboard/alerts/:id で確認済み・解決済みにできる（X-4）。
// 当月だけでなく先々（翌月以降）の注意点も並ぶため、対象の月を「当月」「11月（先々）」のように添える（PDF a01）。

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AlertActions } from "@/components/alert-actions"
import { Skeleton } from "@/components/ui/skeleton"
import { resolveAlertLink, type AlertLinkTarget } from "@/lib/alert-link"
import type { AlertItem } from "@/lib/api"
import { todayJstStr } from "@/lib/date"
import { cn } from "@/lib/utils"
import { format } from "date-fns"

/**
 * アラートの対象の月の表示（純関数）。対象日の無いアラートは出さない。
 * targetDate は宿泊日・対象月の UTC 0時（API の日付）なので、先頭の "yyyy-MM" で月を決める。
 */
export function alertPeriodLabel(targetDate: string | null, today: string = todayJstStr()): { label: string; future: boolean } | null {
  if (!targetDate) return null
  const target = targetDate.slice(0, 7)
  const current = today.slice(0, 7)
  if (target === current) return { label: "当月", future: false }
  const [y, m] = target.split("-").map(Number)
  const yearPrefix = y !== Number(current.slice(0, 4)) ? `${y}年` : ""
  return target > current ? { label: `${yearPrefix}${m}月（先々）`, future: true } : { label: `${yearPrefix}${m}月`, future: false }
}

interface AlertsCardProps {
  alerts: AlertItem[]
  loading: boolean
  onAlertNavigate?: (target: AlertLinkTarget) => void
  /** 「確認済み」「解決済み」操作の後に一覧を取り直す（X-4） */
  onAlertUpdated?: () => void
}

export function AlertsCard({ alerts, loading, onAlertNavigate, onAlertUpdated }: AlertsCardProps) {
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
            当月に加えて先々（翌月以降）の注意点も表示します。重要度5段階のうち Level 5・4 を表示（「解決済み」にすると一覧から外れます。「確認済み」は表示したまま）
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
              const period = alertPeriodLabel(alert.targetDate)
              return (
                <div key={alert.id} className={`border-l-4 ${style.border} ${style.bg} p-3 rounded-r`}>
                  <div className="flex items-start gap-2">
                    <div className={`w-3 h-3 rounded-full ${style.dot} mt-1 flex-shrink-0`}></div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`text-xs font-semibold ${style.text}`}>{style.label}</span>
                        {period && (
                          <span
                            className={cn(
                              "rounded-full border px-2 py-px text-[11px]",
                              period.future ? "border-primary/40 bg-primary/5 text-primary" : "text-muted-foreground",
                            )}
                          >
                            {period.label}
                          </span>
                        )}
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
                      {/* 確認済み・解決済みの操作（X-4） */}
                      <div className="mt-2">
                        <AlertActions alert={alert} onUpdated={() => onAlertUpdated?.()} />
                      </div>
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
