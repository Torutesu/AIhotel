"use client"

// 予約期間（リードタイム）別分析（U-15 で analysis-tab.tsx から分割）。
// 集計APIが未実装のためサンプル表示。2026-10 の画面修正（分析03）で「日のタイプ」の列を足した
// （その予約期間の時点での対象月の日のタイプ。予約期間ごとに並べるとタイプの推移が分かる）。

import { useMemo } from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SampleDataNotice } from "@/components/sample-data-notice"
import { buildPeriodData } from "@/components/analysis/sample-period-data"
import { DayTypeBadge, DayTypeHelp } from "@/components/pricing/day-type"
import { useTargetPeriod, type AnalysisSectionProps } from "@/components/analysis/section-props"

export function BookingPeriodAnalysisSection(props: AnalysisSectionProps) {
  const { targetPeriod } = useTargetPeriod(props)
  const periodData = useMemo(() => buildPeriodData(targetPeriod), [targetPeriod])

  return (
    <div className="space-y-6">
      <SampleDataNotice detail="予約期間（リードタイム）別の集計APIが未実装のため、以下の数値はサンプルです。" />
      <Card>
        <CardHeader>
          <CardTitle>予約期間別分析</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium">予約期間</th>
                  <th className="text-center py-3 px-4 font-medium">
                    <DayTypeHelp />
                  </th>
                  <th className="text-right py-3 px-4 font-medium">予約数</th>
                  <th className="text-right py-3 px-4 font-medium">構成比</th>
                  <th className="text-right py-3 px-4 font-medium">平均ADR</th>
                  <th className="text-right py-3 px-4 font-medium">キャンセル率</th>
                  <th className="text-right py-3 px-4 font-medium">前期比</th>
                </tr>
              </thead>
              <tbody>
                {periodData.bookingWindowData.map((row) => (
                  <tr key={row.window} className="border-b hover:bg-muted/50">
                    <td className="py-3 px-4 font-medium">{row.window}</td>
                    <td className="text-center py-3 px-4">
                      <DayTypeBadge dayType={row.dayType} />
                    </td>
                    <td className="text-right py-3 px-4">{row.bookings}件</td>
                    <td className="text-right py-3 px-4">{row.share.toFixed(1)}%</td>
                    <td className="text-right py-3 px-4">¥{row.adr.toLocaleString()}</td>
                    <td className="text-right py-3 px-4">
                      <span className={row.cancel > 8 ? "text-[color:var(--negative)]" : ""}>
                        {row.cancel.toFixed(1)}%
                      </span>
                    </td>
                    <td className="text-right py-3 px-4">
                      <span
                        className={
                          row.growth >= 0 ? "text-[color:var(--positive)]" : "text-[color:var(--negative)]"
                        }
                      >
                        {row.growth >= 0 ? "+" : ""}
                        {row.growth.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            日のタイプは、その予約期間の時点で対象月の日に最も多かったタイプです（英字 = 着地見込みの需要、数字 = 前年同曜日と比べたペース）。
            予約期間をさかのぼって並べると、需要の見え方がどう変わったか（例: 61日以上前 B3 → 当日 D4）が分かります。
          </p>
        </CardContent>
      </Card>

      <Card className="border-l-4 border-l-[color:var(--chart-3)]">
        <CardHeader>
          <CardTitle className="text-base font-medium">予約期間分析インサイト</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-2 h-2 rounded-full bg-[color:var(--positive)] mt-2" />
            <p className="text-sm leading-relaxed">
              8-14日前の予約が最も多く（25.5%）、この期間の価格設定が収益に大きく影響します。
            </p>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-2 h-2 rounded-full bg-[color:var(--positive)] mt-2" />
            <p className="text-sm leading-relaxed">
              早期予約（31日以上前）の成長率が高く、早割プランの効果が表れています。ADRも高水準を維持しています。
            </p>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-2 h-2 rounded-full bg-[color:var(--negative)] mt-2" />
            <p className="text-sm leading-relaxed">
              61日以上前の予約はキャンセル率が12.1%と高めです。キャンセルポリシーの見直しを検討してください。
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
