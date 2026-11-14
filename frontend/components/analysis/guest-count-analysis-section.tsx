"use client"

// 利用人数別（顧客セグメント別）（2026-10 PDF c分析02）。チャネル別・部屋タイプ別と同じ表・グラフ。
// D-13 で予約明細の実データに（GET /analysis/guest-counts）。1室あたりの人数（宿泊人数 ÷ 室数）で分け、
// 区分ごとの月の予約の積み上がりも予約明細から作る。予約明細が取り込まれていない月は、取り込みの案内を出す。

import { useMemo } from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { monthLabel, parseMonthStr } from "@/lib/date"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, type GuestCounts } from "@/lib/api"
import { useTargetPeriod, type AnalysisSectionProps } from "@/components/analysis/section-props"
import { CompositionShareCharts, CompositionTable, SegmentMonthCurveChart, type CompositionRow } from "@/components/analysis/composition-view"

export function GuestCountAnalysisSection(props: AnalysisSectionProps) {
  const { targetPeriod } = useTargetPeriod(props)
  const { hotelId } = useAuth()
  const { year, month } = parseMonthStr(targetPeriod)
  const query = useApiQuery<GuestCounts>(hotelId ? () => api.guestCounts(hotelId, year, month) : null, [hotelId, year, month], "利用人数別の取得に失敗しました")
  const rows = useMemo<CompositionRow[]>(() => (query.data?.segments ?? []).map((s) => ({ ...s })), [query.data])

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">利用人数別（顧客セグメント別）（{monthLabel(year, month)}）</CardTitle>
        <p className="text-xs text-muted-foreground">
          1室あたりの利用人数ごとの実績です（予約明細 {query.data?.reservations ?? 0}件から集計）。表・グラフはチャネル別・部屋タイプ別と同じ見方です。
        </p>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {query.loading ? (
          <p className="text-sm text-muted-foreground">読み込み中…</p>
        ) : query.error ? (
          <ErrorState message={query.error} onRetry={query.reload} />
        ) : query.data?.reservations === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground" data-testid="no-reservations">
            この月の予約明細がまだ取り込まれていません。設定タブの「予約明細から作る」で、宿泊人数の入った予約明細を取り込むと表示されます。
          </p>
        ) : (
          <>
            <CompositionShareCharts rows={rows} />
            <CompositionTable labelHeader="利用人数" rows={rows} testId="guest-count-composition-table" />
            <SegmentMonthCurveChart rows={rows} title="利用人数別の月のブッキングカーブ" />
          </>
        )}
      </CardContent>
    </Card>
  )
}
