"use client"

// 稼働・ADR月間推移グラフ（U-15 で dashboard-tab.tsx から分割）
// GET /dashboard/kpi の dailyTrend / comparison を表示し、CSV・PNGで書き出す。

import { useCallback, useMemo, useRef } from "react"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts"
import { format } from "date-fns"
import { Download, ImageDown } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { svgToPngBlob } from "@/lib/svg-export"
import { toNumber, type ChartTooltipProps } from "@/lib/chart-tooltip"
import type { DashboardKpi } from "@/lib/api"

interface TrendChartCardProps {
  kpi: DashboardKpi | null
  loading: boolean
  year: number
  month: number
}

export function TrendChartCard({ kpi, loading, year, month }: TrendChartCardProps) {
  // 画像エクスポート時に描画済みSVGを取得するためのラッパー参照
  const chartWrapperRef = useRef<HTMLDivElement>(null)

  const todayKey = format(new Date(), "yyyy-MM-dd")

  // 稼働率・ADRの月間推移チャートデータ（実績→予測の連続系列）
  const trendChartData = useMemo(() => {
    if (!kpi) return []
    const rows = kpi.dailyTrend
    return rows.map((row, idx) => {
      const next = rows[idx + 1]
      const isBoundary = row.isActual && !!next && !next.isActual
      const [, m, d] = row.date.split("-")
      return {
        date: `${Number(m)}/${Number(d)}`,
        rawDate: row.date,
        occupancyActual: row.isActual && row.occupancy != null ? Math.round(row.occupancy * 1000) / 10 : null,
        adrActual: row.isActual ? row.adr : null,
        occupancyForecast: !row.isActual
          ? row.predictedOccupancy != null
            ? Math.round(row.predictedOccupancy * 1000) / 10
            : null
          : isBoundary && row.occupancy != null
            ? Math.round(row.occupancy * 1000) / 10
            : null,
        adrForecast: !row.isActual ? row.predictedAdr : isBoundary ? row.adr : null,
        occupancyLastYear:
          row.lastYearOccupancy != null ? Math.round(row.lastYearOccupancy * 1000) / 10 : null,
        adrLastYear: row.lastYearAdr,
        isToday: row.date === todayKey,
      }
    })
  }, [kpi, todayKey])

  // グラフに引く予算・目標の水平線（F-DASH-03）。月次予算が未登録なら非表示
  const budgetOccupancyLine = useMemo(() => {
    const value = kpi?.comparison?.budgetOccupancy
    return value != null ? Math.round(value * 1000) / 10 : null
  }, [kpi])
  const budgetAdrLine = kpi?.comparison?.budgetAdr ?? null

  const hasLastYearTrend = useMemo(
    () => trendChartData.some((d) => d.occupancyLastYear != null || d.adrLastYear != null),
    [trendChartData]
  )

  // グラフのCSVエクスポート（日付・稼働率・ADR・予測・前年）
  const exportTrendCsv = useCallback(() => {
    if (trendChartData.length === 0) return
    const header = ["日付", "稼働率(%)", "ADR(円)", "予測稼働率(%)", "予測ADR(円)", "前年稼働率(%)", "前年ADR(円)"]
    const rows = trendChartData.map((d) => [
      d.rawDate,
      d.occupancyActual ?? "",
      d.adrActual ?? "",
      d.occupancyForecast ?? "",
      d.adrForecast ?? "",
      d.occupancyLastYear ?? "",
      d.adrLastYear ?? "",
    ])
    const csv = [header, ...rows].map((cols) => cols.join(",")).join("\r\n")
    // Excelで文字化けしないようBOM付きUTF-8で出力
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `稼働ADR月間推移_${year}-${String(month).padStart(2, "0")}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }, [trendChartData, year, month])

  // グラフのPNGエクスポート（描画済みSVGをcanvasに転写。追加ライブラリ不要）
  // 線色は var(--chart-N) / currentColor のため、書き出し前に実色へ解決する（U-10）
  const exportTrendImage = useCallback(async () => {
    const svg = chartWrapperRef.current?.querySelector("svg")
    if (!svg) return
    try {
      const blob = await svgToPngBlob(svg)
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `稼働ADR月間推移_${year}-${String(month).padStart(2, "0")}.png`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "画像の書き出しに失敗しました")
    }
  }, [year, month])

  // 表示中の比較軸（F-DASH-02: 本日まで／累計進捗／年度累計）

  const CustomTooltip = ({ active, payload }: ChartTooltipProps) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border border-border rounded-lg shadow-lg p-3">
          <p className="text-sm font-medium mb-2">{payload[0].payload?.date}</p>
          <div className="space-y-1">
            <p className="text-xs flex items-center gap-2">
              <span className="w-3 h-0.5 bg-[color:var(--chart-1)]"></span>
              <span>稼働率: {payload[0].value != null ? `${toNumber(payload[0].value).toFixed(1)}%` : "-"}</span>
            </p>
            <p className="text-xs flex items-center gap-2">
              <span className="w-3 h-0.5 bg-[color:var(--chart-3)]"></span>
              <span>ADR: {payload[1]?.value != null ? `¥${Math.round(toNumber(payload[1].value)).toLocaleString()}` : "-"}</span>
            </p>
          </div>
        </div>
      )
    }
    return null
  }

  // アラート重要度（1-5の5段階）。ダッシュボードはLevel 5・4のみ表示する（F-DASH-05）

  return (
    <Card>
      <CardHeader className="pb-1">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base font-medium">稼働・ADR月間推移</CardTitle>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={exportTrendCsv}
              disabled={loading || trendChartData.length === 0}
            >
              <Download className="h-3 w-3" />
              CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => void exportTrendImage()}
              disabled={loading || trendChartData.length === 0}
            >
              <ImageDown className="h-3 w-3" />
              画像
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <Skeleton className="h-[300px] w-full" />
        ) : trendChartData.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">この月のデータがありません。</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-0.5 bg-[color:var(--chart-1)]"></div>
                  <span className="font-medium text-xs">稼働率</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-0.5 bg-[color:var(--chart-3)]"></div>
                  <span className="font-medium text-xs">ADR</span>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="w-4 h-0.5 bg-muted-foreground"></span>実線＝実績
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className="w-4 border-t border-dashed border-muted-foreground"
                    aria-hidden
                  ></span>
                  点線＝予測
                </span>
                {hasLastYearTrend && (
                  <span className="flex items-center gap-1.5">
                    <span className="w-4 h-0.5 bg-[color:var(--chart-5)] opacity-70"></span>
                    前年実績
                  </span>
                )}
                {(budgetOccupancyLine != null || budgetAdrLine != null) && (
                  <span className="flex items-center gap-1.5">
                    <span
                      className="w-4 border-t-2 border-dotted border-[color:var(--chart-4)]"
                      aria-hidden
                    ></span>
                    予算・目標
                  </span>
                )}
              </div>
            </div>

            <div ref={chartWrapperRef}>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trendChartData} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  interval={2}
                  stroke="currentColor"
                  opacity={0.6}
                  label={{ value: "日付", position: "insideBottom", offset: -5, style: { textAnchor: "middle", fontSize: 12 } }}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 12 }}
                  stroke="currentColor"
                  opacity={0.6}
                  tickFormatter={(value) => `${value}%`}
                  label={{ value: "稼働率", angle: -90, position: "insideLeft", style: { textAnchor: "middle", fontSize: 12 } }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 12 }}
                  stroke="currentColor"
                  opacity={0.6}
                  tickFormatter={(value) => `¥${(value / 1000).toFixed(0)}k`}
                  label={{ value: "ADR（円）", angle: 90, position: "insideRight", style: { textAnchor: "middle", fontSize: 12 } }}
                />
                <Tooltip content={<CustomTooltip />} />
                {trendChartData.find((d) => d.isToday) && (
                  <ReferenceLine
                    x={trendChartData.find((d) => d.isToday)?.date}
                    stroke="#666"
                    strokeDasharray="5 5"
                    strokeWidth={1.5}
                    label={{ value: `本日 ${trendChartData.find((d) => d.isToday)?.date}`, position: "top", fill: "#666", fontSize: 11 }}
                  />
                )}
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="occupancyActual"
                  stroke="var(--chart-1)"
                  strokeWidth={2.5}
                  dot={false}
                  name="稼働率"
                  activeDot={{ r: 6 }}
                  connectNulls={false}
                />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="occupancyForecast"
                  stroke="var(--chart-1)"
                  strokeWidth={2.5}
                  strokeDasharray="5 5"
                  dot={false}
                  name="稼働率（予測）"
                  activeDot={{ r: 6 }}
                  connectNulls={false}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="adrActual"
                  stroke="var(--chart-3)"
                  strokeWidth={2.5}
                  dot={false}
                  name="ADR"
                  activeDot={{ r: 6 }}
                  connectNulls={false}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="adrForecast"
                  stroke="var(--chart-3)"
                  strokeWidth={2.5}
                  strokeDasharray="5 5"
                  dot={false}
                  name="ADR（予測）"
                  activeDot={{ r: 6 }}
                  connectNulls={false}
                />
                {/* 前年実績（細線で背面に重ねる） */}
                {hasLastYearTrend && (
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="occupancyLastYear"
                    stroke="var(--chart-5)"
                    strokeWidth={1.5}
                    strokeOpacity={0.7}
                    dot={false}
                    name="稼働率（前年）"
                    activeDot={{ r: 4 }}
                    connectNulls
                  />
                )}
                {hasLastYearTrend && (
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="adrLastYear"
                    stroke="var(--chart-5)"
                    strokeWidth={1.5}
                    strokeOpacity={0.7}
                    strokeDasharray="2 3"
                    dot={false}
                    name="ADR（前年）"
                    activeDot={{ r: 4 }}
                    connectNulls
                  />
                )}
                {/* 予算・目標の水平線（月次予算が登録されている場合のみ） */}
                {budgetOccupancyLine != null && (
                  <ReferenceLine
                    yAxisId="left"
                    y={budgetOccupancyLine}
                    stroke="var(--chart-4)"
                    strokeDasharray="2 2"
                    strokeWidth={1.5}
                    label={{
                      value: `予算稼働率 ${budgetOccupancyLine.toFixed(1)}%`,
                      position: "insideTopLeft",
                      fill: "var(--chart-4)",
                      fontSize: 10,
                    }}
                  />
                )}
                {budgetAdrLine != null && (
                  <ReferenceLine
                    yAxisId="right"
                    y={budgetAdrLine}
                    stroke="var(--chart-4)"
                    strokeDasharray="2 2"
                    strokeWidth={1.5}
                    label={{
                      value: `予算ADR ¥${Math.round(budgetAdrLine).toLocaleString()}`,
                      position: "insideBottomRight",
                      fill: "var(--chart-4)",
                      fontSize: 10,
                    }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
