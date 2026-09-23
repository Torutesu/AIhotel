"use client"

// チャネル別分析（#88 / GET /analysis/channels）。対象月の実績を販売チャネルごとに集計する。
// チャネル別の実績は PMS/OTA 連携（Phase 4）まで CSV 取り込みや seed で入る。

import { TrendingDown, TrendingUp } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, type ChannelBreakdown } from "@/lib/api"
import { monthLabel, parseMonthStr } from "@/lib/date"
import { formatYen } from "@/lib/format"
import { useTargetPeriod, type AnalysisSectionProps } from "@/components/analysis/section-props"

function Growth({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>
  const up = value >= 0
  return (
    <span className={`inline-flex items-center gap-1 ${up ? "text-positive" : "text-negative"}`}>
      {up ? <TrendingUp className="h-3 w-3" aria-hidden /> : <TrendingDown className="h-3 w-3" aria-hidden />}
      {up ? "+" : ""}
      {value.toFixed(1)}%
    </span>
  )
}

export function ChannelAnalysisSection(props: AnalysisSectionProps) {
  const { hotelId } = useAuth()
  const { targetPeriod } = useTargetPeriod(props)
  const { year, month } = parseMonthStr(targetPeriod)

  const { data, loading, error, reload } = useApiQuery<ChannelBreakdown>(
    hotelId ? () => api.channelBreakdown(hotelId, year, month) : null,
    [hotelId, year, month],
    "チャネル別の実績の取得に失敗しました",
  )
  const channels = data?.channels ?? []
  const topRevenue = channels[0]
  const topAdr = [...channels].filter((c) => c.adr != null).sort((a, b) => (b.adr ?? 0) - (a.adr ?? 0))[0]
  const topGrowth = [...channels]
    .filter((c) => c.revenueGrowth != null)
    .sort((a, b) => (b.revenueGrowth ?? 0) - (a.revenueGrowth ?? 0))[0]

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">チャネル別パフォーマンス（{monthLabel(year, month)}）</CardTitle>
        <p className="text-xs text-muted-foreground">販売チャネルごとの実績です。前月比は室料売上の比較です。</p>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : channels.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            この月のチャネル別の実績はまだありません（PMS/OTA 連携後、または取り込み後に表示されます）。
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-lg border px-3 py-2.5">
                <p className="mb-1 text-xs font-medium text-muted-foreground">最高収益チャネル</p>
                <div className="text-lg font-semibold">{topRevenue.channel}</div>
                <p className="text-xs text-muted-foreground">売上の{topRevenue.revenueShare.toFixed(1)}%</p>
              </div>
              <div className="rounded-lg border px-3 py-2.5">
                <p className="mb-1 text-xs font-medium text-muted-foreground">最高ADRチャネル</p>
                <div className="text-lg font-semibold">{topAdr?.channel ?? "—"}</div>
                <p className="text-xs text-muted-foreground">{formatYen(topAdr?.adr)}</p>
              </div>
              <div className="rounded-lg border px-3 py-2.5">
                <p className="mb-1 text-xs font-medium text-muted-foreground">前月比の伸びが最も大きいチャネル</p>
                <div className="text-lg font-semibold">{topGrowth?.channel ?? "—"}</div>
                <p className="text-xs">{topGrowth ? <Growth value={topGrowth.revenueGrowth} /> : "前月の実績がありません"}</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="px-2 py-2 text-left font-medium">チャネル</th>
                    <th className="px-2 py-2 text-right font-medium">販売室数</th>
                    <th className="px-2 py-2 text-right font-medium">売上構成比</th>
                    <th className="px-2 py-2 text-right font-medium">ADR</th>
                    <th className="px-2 py-2 text-right font-medium">室料売上</th>
                    <th className="px-2 py-2 text-right font-medium">前月比</th>
                  </tr>
                </thead>
                <tbody>
                  {channels.map((row) => (
                    <tr key={row.channel} className="border-b hover:bg-muted/50">
                      <td className="px-2 py-2 font-medium">{row.channel}</td>
                      <td className="px-2 py-2 text-right">{row.roomsSold.toLocaleString()}室</td>
                      <td className="px-2 py-2 text-right">{row.revenueShare.toFixed(1)}%</td>
                      <td className="px-2 py-2 text-right">{formatYen(row.adr)}</td>
                      <td className="px-2 py-2 text-right font-medium">{formatYen(row.revenue)}</td>
                      <td className="px-2 py-2 text-right">
                        <Growth value={row.revenueGrowth} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
