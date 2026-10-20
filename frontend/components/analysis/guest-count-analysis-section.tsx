"use client"

// 利用人数別（顧客セグメント別）（2026-10 PDF c分析02）。チャネル別・部屋タイプ別と同じ表・グラフ。
// 宿泊人数の入った予約データ（PMS/サイトコントローラー連携）が無いため、数値はサンプル表示。

import { useMemo } from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SampleDataNotice } from "@/components/sample-data-notice"
import { monthLabel, parseMonthStr } from "@/lib/date"
import { buildPeriodData } from "@/components/analysis/sample-period-data"
import { useTargetPeriod, type AnalysisSectionProps } from "@/components/analysis/section-props"
import { CompositionShareCharts, CompositionTable, SegmentMonthCurveChart, type CompositionRow } from "@/components/analysis/composition-view"

export function GuestCountAnalysisSection(props: AnalysisSectionProps) {
  const { targetPeriod } = useTargetPeriod(props)
  const { year, month } = parseMonthStr(targetPeriod)
  const rows = useMemo<CompositionRow[]>(
    () =>
      buildPeriodData(targetPeriod).guestCountData.map((g) => ({
        key: g.guestCount,
        name: g.guestCount,
        soldRooms: g.soldRooms,
        occupancy: g.occupancy,
        adr: g.adr,
        guestUnitPrice: g.guestUnitPrice,
        revenue: g.revenue,
        revenueShare: g.revenueShare,
        roomsShare: g.roomsShare,
        dor: g.dor,
        avgNights: g.avgNights,
        yoy: g.yoy,
      })),
    [targetPeriod],
  )

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">利用人数別（顧客セグメント別）（{monthLabel(year, month)}）</CardTitle>
        <p className="text-xs text-muted-foreground">1室あたりの利用人数ごとの実績です。表・グラフはチャネル別・部屋タイプ別と同じ見方です。</p>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <SampleDataNotice detail="宿泊人数の入った予約データ（PMS/サイトコントローラー連携）が未接続のため、以下の数値はサンプルです。" />
        <CompositionShareCharts rows={rows} />
        <CompositionTable labelHeader="利用人数" rows={rows} testId="guest-count-composition-table" />
        <SegmentMonthCurveChart rows={rows} title="利用人数別の月のブッキングカーブ" />
      </CardContent>
    </Card>
  )
}
