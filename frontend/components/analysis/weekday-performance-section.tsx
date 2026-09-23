"use client"

// 曜日別パフォーマンス分析（#88 / GET /analysis/day-of-week）。対象月の実績を曜日ごとに集計する。
// 週末はホテルの週末定義（設定タブ）で判定する。祝日・休前日の区分は祝日マスタの導入後に対応する。

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { usePeriod } from "@/components/app-state-provider"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, type DayOfWeekBreakdown } from "@/lib/api"
import { DAY_FULL_NAMES, monthLabel } from "@/lib/date"
import { formatPercent, formatYen } from "@/lib/format"

/** 月曜始まりで並べる */
const ORDER = [1, 2, 3, 4, 5, 6, 0]

export function WeekdayPerformanceSection() {
  const { hotelId } = useAuth()
  const { year, month } = usePeriod()

  const { data, loading, error, reload } = useApiQuery<DayOfWeekBreakdown>(
    hotelId ? () => api.dayOfWeekBreakdown(hotelId, year, month) : null,
    [hotelId, year, month],
    "曜日別の実績の取得に失敗しました",
  )
  const rows = ORDER.map((dow) => data?.days.find((d) => d.dayOfWeek === dow)).filter(
    (d): d is DayOfWeekBreakdown["days"][number] => d !== undefined,
  )
  const hasActuals = rows.some((r) => r.days > 0)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">曜日別パフォーマンス（{monthLabel(year, month)}）</CardTitle>
        <p className="text-xs text-muted-foreground">
          実績が入っている日を曜日ごとに集計しています。週末はホテル設定の週末定義で判定します。
          祝日・休前日の区分は祝日マスタの導入後に対応予定です。
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !hasActuals ? (
          <p className="py-6 text-center text-sm text-muted-foreground">この月の実績はまだありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="px-2 py-2 text-left font-medium">曜日</th>
                  <th className="px-2 py-2 text-right font-medium">日数</th>
                  <th className="px-2 py-2 text-right font-medium">稼働率</th>
                  <th className="px-2 py-2 text-right font-medium">ADR</th>
                  <th className="px-2 py-2 text-right font-medium">REV-Per</th>
                  <th className="px-2 py-2 text-right font-medium">室料売上</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.dayOfWeek} className={`border-b hover:bg-muted/50 ${row.isWeekend ? "bg-primary/5" : ""}`}>
                    <td className="px-2 py-2 font-medium">
                      {DAY_FULL_NAMES[row.dayOfWeek]}
                      {row.isWeekend && <span className="ml-1 text-[10px] text-primary">週末</span>}
                    </td>
                    <td className="px-2 py-2 text-right">{row.days}日</td>
                    <td className="px-2 py-2 text-right">{formatPercent(row.occupancy)}</td>
                    <td className="px-2 py-2 text-right">{formatYen(row.adr)}</td>
                    <td className="px-2 py-2 text-right">{formatYen(row.revPar)}</td>
                    <td className="px-2 py-2 text-right font-medium">{formatYen(row.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
