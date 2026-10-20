"use client"

// 部屋タイプ別（#88 / GET /analysis/room-types）。対象月の実績を部屋タイプごとに集計する。
// 2026-10 PDF c分析02: チャネル別・利用人数別と同じ表・グラフ。すべての部屋タイプを出す（多い施設で 20〜25 タイプ）。
// 部屋タイプは設定タブで登録する（#81）。稼働率の分母はその部屋タイプの室数 × 実績日数。

import { useMemo } from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, type RoomTypeBreakdown } from "@/lib/api"
import { monthLabel, parseMonthStr } from "@/lib/date"
import { useTargetPeriod, type AnalysisSectionProps } from "@/components/analysis/section-props"
import { CompositionShareCharts, CompositionTable, SegmentMonthCurveChart, type CompositionRow } from "@/components/analysis/composition-view"

export function RoomTypeAnalysisSection(props: AnalysisSectionProps) {
  const { hotelId } = useAuth()
  const { targetPeriod } = useTargetPeriod(props)
  const { year, month } = parseMonthStr(targetPeriod)

  const { data, loading, error, reload } = useApiQuery<RoomTypeBreakdown>(
    hotelId ? () => api.roomTypeBreakdown(hotelId, year, month) : null,
    [hotelId, year, month],
    "部屋タイプ別の実績の取得に失敗しました",
  )
  const roomTypes = useMemo(() => data?.roomTypes ?? [], [data])
  const hasActuals = roomTypes.some((t) => t.soldRooms > 0)
  const rows = useMemo<CompositionRow[]>(
    () =>
      roomTypes.map((t) => ({
        key: t.roomTypeId,
        name: t.name,
        label: (
          <>
            {t.name}
            <span className="ml-1 font-mono text-[10px] text-muted-foreground">{t.code}</span>
            <span className="ml-1 text-[10px] text-muted-foreground">{t.count}室</span>
          </>
        ),
        soldRooms: t.soldRooms,
        occupancy: t.occupancy,
        adr: t.adr,
        guestUnitPrice: null,
        revenue: t.revenue,
        revenueShare: t.revenueShare,
        roomsShare: t.roomsShare,
        dor: null,
        avgNights: null,
        yoy: t.revenueYoy,
      })),
    [roomTypes],
  )

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">部屋タイプ別（{monthLabel(year, month)}）</CardTitle>
        <p className="text-xs text-muted-foreground">
          すべての部屋タイプを出します。稼働率はその部屋タイプの室数に対する割合です{data ? `（実績 ${data.actualDays}日分）` : ""}。
          前年同月比は室料売上の比較です。
        </p>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
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
          <>
            <CompositionShareCharts rows={rows} />
            <CompositionTable
              labelHeader="部屋タイプ"
              rows={rows}
              testId="room-type-composition-table"
              note="客単価・DOR・平均宿泊数は宿泊人数・泊数の入った予約データ（PMS/サイトコントローラー連携）後に表示します。"
            />
            <SegmentMonthCurveChart rows={rows} title="部屋タイプ別の月のブッキングカーブ" />
          </>
        )}
      </CardContent>
    </Card>
  )
}
