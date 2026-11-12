"use client"

// 予測の準備状況（D-13）。GET /hotels/:id/forecast-readiness の mode（実績が少ない／学習中／準備完了）と、
// 需要予測の機能ごとの状態（稼働中／一部／未稼働）を出す。
//   - ダッシュボード: 準備完了でないときだけ、初期設定のチェックリストの近くに出す（トライアルには出さない — チェックリストと同じ）
//   - 設定タブ: いつも出す（hideWhenFull を付けない）

import { Gauge } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, type ForecastReadiness, type ReadinessMode } from "@/lib/api"
import { cn } from "@/lib/utils"

export const READINESS_MODE_LABELS: Record<ReadinessMode, string> = {
  coldStart: "実績が少ない",
  learning: "学習中",
  full: "準備完了",
}

const MODE_BADGE_CLASS: Record<ReadinessMode, string> = {
  coldStart: "bg-warning/10 text-warning border-warning/40",
  learning: "bg-primary/10 text-primary border-primary/40",
  full: "bg-positive/10 text-positive border-positive/40",
}

type CapabilityStatus = ForecastReadiness["capabilities"][number]["status"]

export const CAPABILITY_STATUS_LABELS: Record<CapabilityStatus, string> = {
  active: "稼働中",
  limited: "一部",
  inactive: "未稼働",
}

const STATUS_BADGE_CLASS: Record<CapabilityStatus, string> = {
  active: "bg-positive/10 text-positive border-positive/40",
  limited: "bg-warning/10 text-warning border-warning/40",
  inactive: "bg-muted text-muted-foreground",
}

interface ForecastReadinessCardProps {
  /** true なら準備完了（full）のときは何も出さない（ダッシュボード用）。トライアルのユーザーにも出さない */
  hideWhenFull?: boolean
}

export function ForecastReadinessCard({ hideWhenFull = false }: ForecastReadinessCardProps) {
  const { hotelId, user } = useAuth()
  // ダッシュボードではチェックリストと同じく、トライアル（デモデータ）のユーザーには出さない
  const skip = hideWhenFull && Boolean(user?.trial)

  const { data, loading, error, reload } = useApiQuery<ForecastReadiness>(
    hotelId && !skip ? () => api.forecastReadiness(hotelId) : null,
    [hotelId, skip],
    "予測の準備状況を取得できませんでした",
  )

  if (skip) return null
  if (hideWhenFull && (loading || data?.mode === "full")) return null

  return (
    <Card data-testid="forecast-readiness-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base font-medium">
          <Gauge className="h-4 w-4" aria-hidden />
          需要予測の準備状況
          {data && (
            <Badge variant="outline" className={cn("text-xs", MODE_BADGE_CLASS[data.mode])}>
              {READINESS_MODE_LABELS[data.mode]}
            </Badge>
          )}
        </CardTitle>
        {data && <CardDescription>{data.summary}</CardDescription>}
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : data ? (
          <>
            <ul className="grid gap-2 sm:grid-cols-2">
              {data.capabilities.map((c) => (
                <li key={c.key} className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
                  <Badge variant="outline" className={cn("mt-0.5 shrink-0 text-[10px]", STATUS_BADGE_CLASS[c.status])}>
                    {CAPABILITY_STATUS_LABELS[c.status]}
                  </Badge>
                  <span>
                    {c.label}
                    {c.detail && <span className="block text-xs text-muted-foreground">{c.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              実績 {data.historyDays.toLocaleString()}日分
              {data.openedOn && `・開業日 ${data.openedOn}`}
              。実績と予約の記録が増えると、使える機能が自動で増えます。
            </p>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
