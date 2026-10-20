"use client"

// 日のタイプ別パフォーマンス（GET /analysis/day-type — PDF c分析01実績推移2）。
// 内容は曜日別パフォーマンスと同じで、曜日の欄に日のタイプ名（平日A型・週末A型・特日A型など）を出す。
// 型の数と構成は AI（過去の結果）が決める。対象日が分からないため、行をクリックすると「1(月)・2(火)」のように日付を出す。

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { usePeriod } from "@/components/app-state-provider"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, type DayTypeBreakdown } from "@/lib/api"
import { monthLabel } from "@/lib/date"
import { DayModelBadge, DayTypeBadge, DayTypeHelp } from "@/components/pricing/day-type"
import { PerformanceBreakdownTable } from "./performance-breakdown-table"

export function DayTypePerformanceSection() {
  const { hotelId } = useAuth()
  const { year, month } = usePeriod()

  const { data, loading, error, reload } = useApiQuery<DayTypeBreakdown>(
    hotelId ? () => api.dayTypeBreakdown(hotelId, year, month) : null,
    [hotelId, year, month],
    "日のタイプ別パフォーマンスの取得に失敗しました",
  )
  const types = data?.types ?? []

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1 text-base font-medium">
          日のタイプ別パフォーマンス（{monthLabel(year, month)}）
          <DayTypeHelp label="" />
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          曜日別と同じ項目を、AI が分けた日のタイプごとに集計します（型の数と構成は過去の結果から AI が決めます）。
          日のタイプは料金カレンダーと同じ判定で、結果の出た日は結果、先の日は今の予約の入り方で決まります。行をクリックすると対象の日を表示します。
        </p>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : types.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            日のタイプを作れる過去の結果がまだ無いため、集計できません。
          </p>
        ) : (
          <>
            <PerformanceBreakdownTable
              labelHeader="日のタイプ"
              testId="day-type-performance-table"
              rows={types.map((t) => ({
                key: t.dayType,
                name: t.dayType,
                label: (
                  <span className="inline-flex items-center gap-1">
                    <DayTypeBadge dayType={t.dayType} model={t.model} />
                    <DayModelBadge model={t.model} />
                  </span>
                ),
                row: t,
              }))}
            />
            {(data?.untypedDays ?? 0) > 0 && (
              <p className="text-[10px] text-muted-foreground">
                ※ 過去の結果が足りず型を決められなかった日（{data?.untypedDays}日）は含めていません。
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
