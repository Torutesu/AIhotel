"use client"

// 曜日別パフォーマンス（#88 / GET /analysis/day-of-week）。
// 前月以前は実績、当月以降は 実績＋予約。項目は日別パフォーマンスと同じく 販売室数〜前年比（PDF c分析01実績推移2）。
// 週末はホテルの週末定義（設定タブ）で判定する。祝日・休前日は「日のタイプ別」の特日で見る。

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { usePeriod } from "@/components/app-state-provider"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, type DayOfWeekBreakdown } from "@/lib/api"
import { DAY_FULL_NAMES, monthLabel } from "@/lib/date"
import { PerformanceBreakdownTable } from "./performance-breakdown-table"

/** 月曜始まりで並べる */
const ORDER = [1, 2, 3, 4, 5, 6, 0]

export function WeekdayPerformanceSection() {
  const { hotelId } = useAuth()
  const { year, month } = usePeriod()

  const { data, loading, error, reload } = useApiQuery<DayOfWeekBreakdown>(
    hotelId ? () => api.dayOfWeekBreakdown(hotelId, year, month) : null,
    [hotelId, year, month],
    "曜日別パフォーマンスの取得に失敗しました",
  )
  const rows = ORDER.map((dow) => data?.days.find((d) => d.dayOfWeek === dow)).filter(
    (d): d is DayOfWeekBreakdown["days"][number] => d !== undefined,
  )
  const hasData = rows.some((r) => r.days > 0)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">曜日別パフォーマンス（{monthLabel(year, month)}）</CardTitle>
        <p className="text-xs text-muted-foreground">
          前月以前は実績、当月以降は 実績＋予約（今の予約室数）で曜日ごとに集計します。（ ）内は予約の室数です。
          ADR・REV-Per・室料売上は結果の出た日だけで出します（予約の単価は PMS 連携後）。週末はホテル設定の週末定義で判定します。
          行をクリックすると対象の日を表示します。
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !hasData ? (
          <p className="py-6 text-center text-sm text-muted-foreground">この月の実績・予約はまだありません。</p>
        ) : (
          <PerformanceBreakdownTable
            labelHeader="曜日"
            testId="weekday-performance-table"
            rows={rows.map((row) => ({
              key: String(row.dayOfWeek),
              name: DAY_FULL_NAMES[row.dayOfWeek],
              highlight: row.isWeekend,
              label: (
                <>
                  {DAY_FULL_NAMES[row.dayOfWeek]}
                  {row.isWeekend && <span className="ml-1 text-[10px] text-primary">週末</span>}
                </>
              ),
              row,
            }))}
          />
        )}
      </CardContent>
    </Card>
  )
}
