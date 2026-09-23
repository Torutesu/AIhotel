"use client"

// 部屋タイプ別分析（#88 / GET /analysis/room-types）。対象月の実績を部屋タイプごとに集計する。
// 部屋タイプは設定タブで登録する（#81）。稼働率の分母はその部屋タイプの室数 × 実績日数。

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, type RoomTypeBreakdown } from "@/lib/api"
import { monthLabel, parseMonthStr } from "@/lib/date"
import { formatPercent, formatYen } from "@/lib/format"
import { useTargetPeriod, type AnalysisSectionProps } from "@/components/analysis/section-props"

export function RoomTypeAnalysisSection(props: AnalysisSectionProps) {
  const { hotelId } = useAuth()
  const { targetPeriod } = useTargetPeriod(props)
  const { year, month } = parseMonthStr(targetPeriod)

  const { data, loading, error, reload } = useApiQuery<RoomTypeBreakdown>(
    hotelId ? () => api.roomTypeBreakdown(hotelId, year, month) : null,
    [hotelId, year, month],
    "部屋タイプ別の実績の取得に失敗しました",
  )
  const roomTypes = data?.roomTypes ?? []
  const hasActuals = roomTypes.some((t) => t.soldRooms > 0)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">部屋タイプ別パフォーマンス（{monthLabel(year, month)}）</CardTitle>
        <p className="text-xs text-muted-foreground">
          稼働率はその部屋タイプの室数に対する割合です{data ? `（実績 ${data.actualDays}日分）` : ""}。
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : roomTypes.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            部屋タイプが登録されていません。設定タブの「部屋タイプ」から登録してください。
          </p>
        ) : !hasActuals ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            この月の部屋タイプ別の実績はまだありません（PMS 連携後に表示されます）。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="px-2 py-2 text-left font-medium">部屋タイプ</th>
                  <th className="px-2 py-2 text-right font-medium">室数</th>
                  <th className="px-2 py-2 text-right font-medium">販売室数</th>
                  <th className="px-2 py-2 text-right font-medium">稼働率</th>
                  <th className="px-2 py-2 text-right font-medium">ADR</th>
                  <th className="px-2 py-2 text-right font-medium">室料売上</th>
                </tr>
              </thead>
              <tbody>
                {roomTypes.map((row) => (
                  <tr key={row.roomTypeId} className="border-b hover:bg-muted/50">
                    <td className="px-2 py-2 font-medium">
                      {row.name}
                      <span className="ml-1 font-mono text-[10px] text-muted-foreground">{row.code}</span>
                    </td>
                    <td className="px-2 py-2 text-right">{row.count.toLocaleString()}室</td>
                    <td className="px-2 py-2 text-right">{row.soldRooms.toLocaleString()}室</td>
                    <td className="px-2 py-2 text-right">{formatPercent(row.occupancy)}</td>
                    <td className="px-2 py-2 text-right">{formatYen(row.adr)}</td>
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
