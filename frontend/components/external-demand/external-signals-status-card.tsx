"use client"

// 外部要因の取得状況（D-13 — GET /external-signals/status。実データ）。
// 天気（気象庁の予報）の最終取得・祝日（内閣府の一覧）の収録年・外部要因エージェントの最終実行・件数・失敗理由。

import { RefreshCw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, type ExternalSignalsStatus } from "@/lib/api"

const RUN_STATUS_LABELS: Record<string, string> = { running: "実行中", succeeded: "成功", failed: "失敗" }

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("ja-JP", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

export function ExternalSignalsStatusCard() {
  const { hotelId } = useAuth()
  const { data, loading, error, reload } = useApiQuery<ExternalSignalsStatus>(
    hotelId ? () => api.externalSignalsStatus(hotelId) : null,
    [hotelId],
    "外部要因の取得状況を取得できませんでした",
  )
  const lastRun = data?.agent.recentRuns[0] ?? null

  return (
    <Card data-testid="external-signals-status">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-medium">
          <RefreshCw className="h-4 w-4" aria-hidden />
          外部要因の取得状況
        </CardTitle>
        <CardDescription>天気・祝日・外部要因エージェント（イベント・新規ホテル・市場の動きを Web 検索で集める）の取得の記録です。</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : data ? (
          <dl className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
            <div className="rounded-md border px-3 py-2">
              <dt className="text-xs text-muted-foreground">天気の最終取得</dt>
              <dd>
                {data.weather ? (
                  <>
                    {formatDateTime(data.weather.reportedAt)} 発表
                    <span className="block text-xs text-muted-foreground">
                      予報区 {data.weather.areaCode}・{data.weather.daysAhead}日先まで
                    </span>
                    <span className="block text-[11px] text-muted-foreground">出典：気象庁ホームページ</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">まだ取得していません（都道府県か予報区を設定すると取得します）</span>
                )}
              </dd>
            </div>
            <div className="rounded-md border px-3 py-2">
              <dt className="text-xs text-muted-foreground">祝日の収録年</dt>
              <dd>
                {data.holidays.knownThrough}年まで
                <span className="block text-xs text-muted-foreground">内閣府の「国民の祝日」の一覧から</span>
              </dd>
            </div>
            <div className="rounded-md border px-3 py-2">
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                外部要因エージェント
                <Badge variant="outline" className="text-[10px]">
                  {data.agent.enabled ? `${data.agent.intervalDays}日ごと` : "停止中"}
                </Badge>
              </dt>
              <dd>
                {!data.agent.enabled && <span className="block text-muted-foreground">動いていません（API キーの設定後に動きます）</span>}
                {lastRun ? (
                  <>
                    最終実行 {formatDateTime(lastRun.startedAt)}（{RUN_STATUS_LABELS[lastRun.status] ?? lastRun.status}）
                    <span className="block text-xs text-muted-foreground">
                      イベント {lastRun.eventsSaved}件・新規ホテル {lastRun.openingsSaved}件・市場の動き {lastRun.signalsSaved}件（検索 {lastRun.webSearches}回）
                    </span>
                    {lastRun.errorMessage && <span className="block text-xs text-negative">失敗の理由: {lastRun.errorMessage}</span>}
                  </>
                ) : (
                  data.agent.enabled && <span className="text-muted-foreground">まだ実行していません</span>
                )}
                <span className="block text-xs text-muted-foreground">
                  今後のAI収集のイベント {data.agent.upcomingAgentEvents}件・有効な市場の動き {data.agent.activeSignals}件
                </span>
              </dd>
            </div>
          </dl>
        ) : null}
      </CardContent>
    </Card>
  )
}
