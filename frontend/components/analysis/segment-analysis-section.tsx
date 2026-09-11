"use client"

// 顧客セグメント・利用人数別分析（U-15 で analysis-tab.tsx から分割）。
// 集計APIが未実装のためサンプル表示。

import { useMemo, useState } from "react"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SampleDataNotice } from "@/components/sample-data-notice"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { buildPeriodData } from "@/components/analysis/sample-period-data"
import { useTargetPeriod, type AnalysisSectionProps } from "@/components/analysis/section-props"
import { toNumber, type ChartTooltipEntry, type ChartTooltipProps } from "@/lib/chart-tooltip"

export function SegmentAnalysisSection(props: AnalysisSectionProps) {
  const { targetPeriod } = useTargetPeriod(props)
  const periodData = useMemo(() => buildPeriodData(targetPeriod), [targetPeriod])
  const [segmentViewMode, setSegmentViewMode] = useState<"guest-count" | "segment">("guest-count")

  const ComparisonTooltip = ({ active, payload }: ChartTooltipProps) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border border-border rounded-lg shadow-lg p-3">
          <p className="text-sm font-medium mb-2">{payload[0].payload?.month}</p>
          <div className="space-y-1">
            {payload.map((entry: ChartTooltipEntry, index: number) => {
              const value = toNumber(entry.value)
              return (
                <p key={index} className="text-xs flex items-center gap-2">
                  <span className="w-3 h-0.5" style={{ backgroundColor: entry.color }}></span>
                  <span>
                    {entry.name}:{" "}
                    {entry.dataKey === "revenue" || entry.dataKey === "budget" || entry.dataKey === "lastYear"
                      ? `¥${(value / 1000000).toFixed(1)}M`
                      : entry.dataKey === "adr"
                        ? `¥${Math.round(value).toLocaleString()}`
                        : `${Math.round(value)}%`}
                  </span>
                </p>
              )
            })}
          </div>
        </div>
      )
    }
    return null
  }

  return (
    <div className="space-y-6">
      <SampleDataNotice detail="顧客セグメント・利用人数別の集計APIが未実装のため、以下の数値はサンプルです。" />
      {/* AI解説を一番上に */}
      <Card className="bg-[color:var(--sky-wash)]/25 border-[color:var(--cyan-edge)]/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <span className="text-xl" aria-hidden>
              🤖
            </span>
            顧客セグメント分析インサイト
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-2 text-sm leading-relaxed">
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-[color:var(--positive)] mt-2 flex-shrink-0" />
              <p>
                ビジネス客が42.1%を占め最大セグメントですが、ADRは比較的低めです。平日の稼働率維持に重要な役割を果たしています。
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-[color:var(--positive)] mt-2 flex-shrink-0" />
              <p>
                VIP/リピーター客のLTVが¥178,500と最も高く、ロイヤルティプログラムの強化が収益向上につながります。
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-[color:var(--chart-2)] mt-2 flex-shrink-0" />
              <p>
                レジャー（家族）セグメントは平均宿泊数2.8泊と長く、週末の収益最大化に貢献しています。
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 表示モード選択 */}
      <Card>
        <CardContent className="py-3 px-4">
          <div className="flex items-center gap-3">
            <Label htmlFor="segment-view-mode" className="text-sm whitespace-nowrap">表示モード</Label>
            <Select value={segmentViewMode} onValueChange={(value: "guest-count" | "segment") => setSegmentViewMode(value)}>
              <SelectTrigger id="segment-view-mode" className="h-9 w-48 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="guest-count">利用人数別（デフォルト）</SelectItem>
                <SelectItem value="segment">顧客セグメント別</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* 利用人数別パフォーマンス */}
      {segmentViewMode === "guest-count" && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-medium">利用人数別パフォーマンス</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-4">
                {/* グラフ表示 */}
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={periodData.guestCountData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                    <XAxis
                      dataKey="guestCount"
                      tick={{ fontSize: 11 }}
                      stroke="currentColor"
                      opacity={0.5}
                      label={{ value: '利用人数', position: 'insideBottom', offset: -5, style: { textAnchor: 'middle', fontSize: 12 } }}
                    />
                    <YAxis
                      yAxisId="left"
                      tick={{ fontSize: 11 }}
                      stroke="currentColor"
                      opacity={0.5}
                      tickFormatter={(value) => `${value}件`}
                      label={{ value: '予約数', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fontSize: 12 } }}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      tick={{ fontSize: 11 }}
                      stroke="currentColor"
                      opacity={0.5}
                      tickFormatter={(value) => `¥${(value / 1000).toFixed(0)}k`}
                      label={{ value: 'ADR', angle: 90, position: 'insideRight', style: { textAnchor: 'middle', fontSize: 12 } }}
                    />
                    <Tooltip content={<ComparisonTooltip />} />
                    <Legend wrapperStyle={{ fontSize: "12px" }} />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="bookings"
                      stroke="#2563eb"
                      strokeWidth={3}
                      dot={{ r: 4 }}
                      name="予約数"
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="adr"
                      stroke="#ef4444"
                      strokeWidth={3}
                      dot={{ r: 4 }}
                      name="ADR"
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="unitPrice"
                      stroke="#16a34a"
                      strokeWidth={3}
                      dot={{ r: 4 }}
                      name="客単価"
                    />
                  </LineChart>
                </ResponsiveContainer>

                {/* テーブル表示 */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-3 px-4 font-medium">利用人数</th>
                        <th className="text-right py-3 px-4 font-medium">予約数</th>
                        <th className="text-right py-3 px-4 font-medium">構成比</th>
                        <th className="text-right py-3 px-4 font-medium">平均ADR</th>
                        <th className="text-right py-3 px-4 font-medium">客単価</th>
                        <th className="text-right py-3 px-4 font-medium">平均宿泊数</th>
                        <th className="text-right py-3 px-4 font-medium">LTV</th>
                      </tr>
                    </thead>
                    <tbody>
                      {periodData.guestCountData.map((row) => (
                        <tr key={row.guestCount} className="border-b hover:bg-muted/50">
                          <td className="py-3 px-4 font-medium">{row.guestCount}</td>
                          <td className="text-right py-3 px-4">{row.bookings}件</td>
                          <td className="text-right py-3 px-4">{row.share.toFixed(1)}%</td>
                          <td className="text-right py-3 px-4">¥{row.adr.toLocaleString()}</td>
                          <td className="text-right py-3 px-4">¥{row.unitPrice.toLocaleString()}</td>
                          <td className="text-right py-3 px-4">{row.nights.toFixed(1)}泊</td>
                          <td className="text-right py-3 px-4 font-medium">¥{row.ltv.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* 顧客セグメント別パフォーマンス */}
      {segmentViewMode === "segment" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">顧客セグメント別パフォーマンス</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-4">
              {/* グラフ表示 */}
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={periodData.segmentData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                  <XAxis
                    dataKey="segment"
                    tick={{ fontSize: 11 }}
                    stroke="currentColor"
                    opacity={0.5}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    label={{ value: 'セグメント', position: 'insideBottom', offset: -5, style: { textAnchor: 'middle', fontSize: 12 } }}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 11 }}
                    stroke="currentColor"
                    opacity={0.5}
                    tickFormatter={(value) => `${value}件`}
                    label={{ value: '予約数', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fontSize: 12 } }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 11 }}
                    stroke="currentColor"
                    opacity={0.5}
                    tickFormatter={(value) => `¥${(value / 1000).toFixed(0)}k`}
                    label={{ value: 'ADR', angle: 90, position: 'insideRight', style: { textAnchor: 'middle', fontSize: 12 } }}
                  />
                  <Tooltip content={<ComparisonTooltip />} />
                  <Legend wrapperStyle={{ fontSize: "12px" }} />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="bookings"
                    stroke="#2563eb"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                    name="予約数"
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="adr"
                    stroke="#ef4444"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                    name="ADR"
                  />
                </LineChart>
              </ResponsiveContainer>

              {/* テーブル表示 */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 font-medium">セグメント</th>
                      <th className="text-right py-3 px-4 font-medium">予約数</th>
                      <th className="text-right py-3 px-4 font-medium">構成比</th>
                      <th className="text-right py-3 px-4 font-medium">平均ADR</th>
                      <th className="text-right py-3 px-4 font-medium">平均宿泊数</th>
                      <th className="text-right py-3 px-4 font-medium">LTV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periodData.segmentData.map((row) => (
                      <tr key={row.segment} className="border-b hover:bg-muted/50">
                        <td className="py-3 px-4 font-medium">{row.segment}</td>
                        <td className="text-right py-3 px-4">{row.bookings}件</td>
                        <td className="text-right py-3 px-4">{row.share.toFixed(1)}%</td>
                        <td className="text-right py-3 px-4">¥{row.adr.toLocaleString()}</td>
                        <td className="text-right py-3 px-4">{row.nights.toFixed(1)}泊</td>
                        <td className="text-right py-3 px-4 font-medium">¥{row.ltv.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
