"use client"

// チャネル別分析（U-15 で analysis-tab.tsx から分割）。PMS/OTA連携が未実装のためサンプル表示。

import { useMemo } from "react"
import { TrendingUp } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SampleDataNotice } from "@/components/sample-data-notice"
import { buildPeriodData } from "@/components/analysis/sample-period-data"
import { useTargetPeriod, type AnalysisSectionProps } from "@/components/analysis/section-props"

export function ChannelAnalysisSection(props: AnalysisSectionProps) {
  const { targetPeriod } = useTargetPeriod(props)
  const periodData = useMemo(() => buildPeriodData(targetPeriod), [targetPeriod])

  return (
    <div className="space-y-4">
      <SampleDataNotice detail="PMS/OTA連携が未実装のため、チャネル別の数値はサンプルです。" />
      {/* AI解説を一番上に */}
      <Card className="bg-[color:var(--sky-wash)]/25 border-[color:var(--cyan-edge)]/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <span className="text-xl" aria-hidden>
              🤖
            </span>
            チャネル分析インサイト
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-2 text-sm leading-relaxed">
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-[color:var(--positive)] mt-2 flex-shrink-0" />
              <p>
                公式サイトが全体の38.5%を占め、最も重要なチャネルとなっています。前期比+12.3%と好調に成長しています。
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-[color:var(--positive)] mt-2 flex-shrink-0" />
              <p>
                公式アプリの成長率が+24.8%と突出しており、モバイル戦略の強化が効果を発揮しています。
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-[color:var(--chart-2)] mt-2 flex-shrink-0" />
              <p>
                電話直接予約のADRが¥21,450と最も高く、高単価顧客の獲得チャネルとして重要です。
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="py-2.5 px-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">最高収益チャネル</p>
            <div className="text-lg font-semibold mb-0.5">公式サイト</div>
            <p className="text-xs text-muted-foreground">全体の38.5%</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-2.5 px-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">最高ADRチャネル</p>
            <div className="text-lg font-semibold mb-0.5">電話直接</div>
            <p className="text-xs text-muted-foreground">¥{periodData.channelData[3].adr.toLocaleString()}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-2.5 px-3">
            <p className="text-xs font-medium text-muted-foreground mb-1">成長率トップ</p>
            <div className="text-lg font-semibold mb-0.5">公式アプリ</div>
            <div className="flex items-center gap-1">
              <TrendingUp className="w-3 h-3 text-[color:var(--positive)]" />
              <span className="text-xs text-[color:var(--positive)]">
                +{periodData.channelData[4].growth.toFixed(1)}% vs 前期
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">チャネル別パフォーマンス</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-2 font-medium">チャネル</th>
                  <th className="text-right py-2 px-2 font-medium">予約数</th>
                  <th className="text-right py-2 px-2 font-medium">構成比</th>
                  <th className="text-right py-2 px-2 font-medium">ADR</th>
                  <th className="text-right py-2 px-2 font-medium">売上</th>
                  <th className="text-right py-2 px-2 font-medium">前期比</th>
                  <th className="text-center py-2 px-2 font-medium">トレンド</th>
                </tr>
              </thead>
              <tbody>
                {periodData.channelData.map((row) => (
                  <tr key={row.channel} className="border-b hover:bg-muted/50">
                    <td className="py-2 px-2 font-medium">{row.channel}</td>
                    <td className="text-right py-2 px-2">{row.bookings}件</td>
                    <td className="text-right py-2 px-2">{row.share.toFixed(1)}%</td>
                    <td className="text-right py-2 px-2">¥{row.adr.toLocaleString()}</td>
                    <td className="text-right py-2 px-2 font-medium">¥{row.revenue.toLocaleString()}</td>
                    <td className="text-right py-2 px-2">
                      <span className="text-[color:var(--positive)]">+{row.growth.toFixed(1)}%</span>
                    </td>
                    <td className="text-center py-2 px-2">
                      {row.trend === "up" && (
                        <TrendingUp className="w-4 h-4 text-[color:var(--positive)] mx-auto" />
                      )}
                      {row.trend === "stable" && <span className="text-muted-foreground">→</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
