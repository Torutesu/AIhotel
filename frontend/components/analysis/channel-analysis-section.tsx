"use client"

// チャネル別（#88 / GET /analysis/channels）。対象月の実績を販売チャネルごとに集計する。
// 2026-10 PDF c分析02: 表とグラフを部屋タイプ別・利用人数別と同じ見方にそろえ、前月比ではなく前年同月比を出す。
// チャネルは 100 を超えることもあるため上位10社を出し、残りは「その他」にまとめる。
// チャネル別の実績は PMS/OTA 連携（Phase 4）まで CSV 取り込みや seed で入る。

import { useMemo } from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, type ChannelBreakdown } from "@/lib/api"
import { monthLabel, parseMonthStr } from "@/lib/date"
import { useTargetPeriod, type AnalysisSectionProps } from "@/components/analysis/section-props"
import {
  CompositionShareCharts,
  CompositionTable,
  SegmentMonthCurveChart,
  topWithOthers,
  type CompositionRow,
} from "@/components/analysis/composition-view"

/** 表とグラフに出すチャネルの数（c分析02「上位10社を掲示」） */
export const TOP_CHANNELS = 10

export function ChannelAnalysisSection(props: AnalysisSectionProps) {
  const { hotelId } = useAuth()
  const { targetPeriod } = useTargetPeriod(props)
  const { year, month } = parseMonthStr(targetPeriod)

  const { data, loading, error, reload } = useApiQuery<ChannelBreakdown>(
    hotelId ? () => api.channelBreakdown(hotelId, year, month) : null,
    [hotelId, year, month],
    "チャネル別の実績の取得に失敗しました",
  )
  const channels = useMemo(() => data?.channels ?? [], [data])
  const rows = useMemo<CompositionRow[]>(
    () =>
      topWithOthers(
        channels.map((c) => ({
          key: c.channel,
          name: c.channel,
          soldRooms: c.roomsSold,
          occupancy: c.occupancy,
          adr: c.adr,
          // 人数・泊数は予約データ（PMS/サイトコントローラー連携）後
          guestUnitPrice: null,
          revenue: c.revenue,
          revenueShare: c.revenueShare,
          roomsShare: c.roomsShare,
          dor: null,
          avgNights: null,
          yoy: c.revenueYoy,
          lastYearRevenue: c.lastYearRevenue,
        })),
        TOP_CHANNELS,
        "社",
        true,
      ),
    [channels],
  )

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">チャネル別（{monthLabel(year, month)}）</CardTitle>
        <p className="text-xs text-muted-foreground">
          販売チャネルごとの実績です（室料売上の多い順に上位{TOP_CHANNELS}社。11社目以降は「その他」）。
          稼働率は客室数に対するそのチャネルの販売室数の割合、前年同月比は室料売上の比較です。
        </p>
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
            <CompositionShareCharts rows={rows} />
            <CompositionTable
              labelHeader="チャネル"
              rows={rows}
              testId="channel-composition-table"
              note={`全${channels.length}社。客単価・DOR・平均宿泊数は宿泊人数・泊数の入った予約データ（PMS/サイトコントローラー連携）後に表示します。`}
            />
            <SegmentMonthCurveChart rows={rows} title="チャネル別の月のブッキングカーブ" />
          </>
        )}
      </CardContent>
    </Card>
  )
}
