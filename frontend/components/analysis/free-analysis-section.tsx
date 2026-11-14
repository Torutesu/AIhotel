"use client"

// フリー分析（U-15 で analysis-tab.tsx から分割。D-13 で予約明細の実データに — GET /analysis/free）。
// 分析軸（1〜2つ）と集計項目を選ぶと、対象月の泊を集計して、単一軸はグラフ＋表、クロスは表で出す。
// 軸はチャネル・予約期間・利用人数・曜日・日付（日付は軸1だけ）。部屋タイプと顧客セグメントは予約明細に無いので出さない。

import { useState } from "react"
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { useTargetPeriod, type AnalysisSectionProps } from "@/components/analysis/section-props"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, type FreeAnalysis, type FreeAnalysisAxis, type FreeAnalysisMetric } from "@/lib/api"
import { monthLabel, parseMonthStr } from "@/lib/date"
import { toNumber, type ChartTooltipEntry, type ChartTooltipProps } from "@/lib/chart-tooltip"

type CrossAxis = Exclude<FreeAnalysisAxis, "date">

export const FREE_AXIS_LABELS: Record<FreeAnalysisAxis, string> = {
  channel: "チャネル",
  booking: "予約期間",
  guests: "利用人数",
  dayofweek: "曜日",
  date: "日付",
}
export const FREE_METRIC_LABELS: Record<FreeAnalysisMetric, string> = {
  rooms: "販売室数",
  occupancy: "稼働率",
  adr: "ADR",
  revpar: "REV-Per",
  revenue: "室料売上",
  bookings: "予約数",
}

/** 集計項目に合わせた表示（null は「—」） */
export function formatFreeValue(metric: FreeAnalysisMetric, value: number | null): string {
  if (value == null) return "—"
  if (metric === "occupancy") return `${value.toFixed(1)}%`
  if (metric === "adr" || metric === "revpar" || metric === "revenue") return `¥${value.toLocaleString()}`
  if (metric === "rooms") return `${value.toLocaleString()}室`
  return `${value.toLocaleString()}件`
}

export function FreeAnalysisSection(props: AnalysisSectionProps = {}) {
  const { targetPeriod } = useTargetPeriod(props)
  const { hotelId } = useAuth()
  const { year, month } = parseMonthStr(targetPeriod)
  const [axis1, setAxis1] = useState<FreeAnalysisAxis | "">("")
  const [axis2, setAxis2] = useState<CrossAxis | "none">("none")
  const [metric, setMetric] = useState<FreeAnalysisMetric | "">("")
  const cross = axis2 !== "none" && axis2 !== axis1 ? axis2 : null

  const query = useApiQuery<FreeAnalysis>(
    hotelId && axis1 && metric ? () => api.freeAnalysis(hotelId, year, month, axis1, cross, metric) : null,
    [hotelId, year, month, axis1, cross, metric],
    "フリー分析の集計に失敗しました",
  )
  const data = query.data
  const valueAt = (a: string, b: string | null) => data?.rows.find((r) => r.axis1 === a && r.axis2 === b)?.value ?? null

  const FreeAnalysisTooltip = ({ active, payload }: ChartTooltipProps) => {
    if (!active || !payload?.length || !metric) return null
    const row = payload[0].payload as { axis1: string } | undefined
    return (
      <div className="rounded-lg border border-border bg-background p-3 shadow-lg">
        <p className="mb-2 text-sm font-medium">{row?.axis1}</p>
        {payload.map((entry: ChartTooltipEntry, index: number) => (
          <p key={index} className="text-xs">
            {FREE_METRIC_LABELS[metric]}: {formatFreeValue(metric, toNumber(entry.value))}
          </p>
        ))}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">フリー分析（{monthLabel(year, month)}）</CardTitle>
        <p className="mt-1 text-xs text-muted-foreground">
          分析軸と集計項目を選んで、対象月の泊を自由に集計します（予約明細から。取消は数えません）。部屋タイプ・顧客セグメントの軸は予約明細にその列が入ってから使えます。
        </p>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="free-analysis-axis1" className="whitespace-nowrap text-xs">
              分析軸1
            </Label>
            <Select value={axis1} onValueChange={(v: FreeAnalysisAxis) => setAxis1(v)}>
              <SelectTrigger id="free-analysis-axis1" className="h-8 w-40 text-xs">
                <SelectValue placeholder="選択してください" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(FREE_AXIS_LABELS) as FreeAnalysisAxis[]).map((a) => (
                  <SelectItem key={a} value={a}>
                    {FREE_AXIS_LABELS[a]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <Label htmlFor="free-analysis-axis2" className="whitespace-nowrap text-xs">
              分析軸2
            </Label>
            <Select value={axis2} onValueChange={(v: CrossAxis | "none") => setAxis2(v)} disabled={axis1 === "date"}>
              <SelectTrigger id="free-analysis-axis2" className="h-8 w-40 text-xs">
                <SelectValue placeholder="なし（単一軸）" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">なし（単一軸）</SelectItem>
                {(Object.keys(FREE_AXIS_LABELS) as FreeAnalysisAxis[])
                  .filter((a): a is CrossAxis => a !== "date" && a !== axis1)
                  .map((a) => (
                    <SelectItem key={a} value={a}>
                      {FREE_AXIS_LABELS[a]}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <Label htmlFor="free-analysis-metric" className="whitespace-nowrap text-xs">
              集計項目
            </Label>
            <Select value={metric} onValueChange={(v: FreeAnalysisMetric) => setMetric(v)}>
              <SelectTrigger id="free-analysis-metric" className="h-8 w-40 text-xs">
                <SelectValue placeholder="選択してください" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(FREE_METRIC_LABELS) as FreeAnalysisMetric[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {FREE_METRIC_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {!axis1 || !metric ? (
          <div className="py-8 text-center text-sm text-muted-foreground">分析軸1と集計項目を選択して分析を開始してください</div>
        ) : query.loading ? (
          <p className="text-sm text-muted-foreground">集計しています…</p>
        ) : query.error ? (
          <ErrorState message={query.error} onRetry={query.reload} />
        ) : !data || data.reservations === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground" data-testid="no-free-analysis">
            この月の予約明細がまだ取り込まれていません。設定タブの「予約明細から作る」で取り込むと集計できます。
          </p>
        ) : cross ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="free-analysis-cross-table">
              <thead>
                <tr className="border-b">
                  <th className="px-2 py-2 text-left font-medium">
                    {FREE_AXIS_LABELS[axis1]} ＼ {FREE_AXIS_LABELS[cross]}
                  </th>
                  {data.axis2Values.map((b) => (
                    <th key={b} className="px-2 py-2 text-right font-medium">
                      {b}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.axis1Values.map((a) => (
                  <tr key={a} className="border-b hover:bg-muted/50">
                    <td className="px-2 py-2 font-medium">{a}</td>
                    {data.axis2Values.map((b) => (
                      <td key={b} className="px-2 py-2 text-right tabular-nums">
                        {formatFreeValue(metric, valueAt(a, b))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="space-y-4">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.rows} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                <XAxis dataKey="axis1" tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.5} angle={-45} textAnchor="end" height={80} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="currentColor"
                  opacity={0.5}
                  label={{ value: FREE_METRIC_LABELS[metric], angle: -90, position: "insideLeft", style: { textAnchor: "middle", fontSize: 12 } }}
                />
                <Tooltip content={<FreeAnalysisTooltip />} />
                <Bar dataKey="value" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="overflow-x-auto">
              <table className="w-full text-xs" data-testid="free-analysis-table">
                <thead>
                  <tr className="border-b">
                    <th className="px-2 py-2 text-left font-medium">{FREE_AXIS_LABELS[axis1]}</th>
                    <th className="px-2 py-2 text-right font-medium">{FREE_METRIC_LABELS[metric]}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.axis1} className="border-b hover:bg-muted/50">
                      <td className="px-2 py-2 font-medium">{row.axis1}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{formatFreeValue(metric, row.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {data && data.reservations > 0 && <p className="text-[10px] text-muted-foreground">予約明細 {data.reservations.toLocaleString()}件から集計</p>}
      </CardContent>
    </Card>
  )
}
