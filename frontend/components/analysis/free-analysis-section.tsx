"use client"

// フリー分析（U-15 で analysis-tab.tsx から分割）。集計APIが未実装のためサンプル表示。

import { useMemo, useState } from "react"
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SampleDataNotice } from "@/components/sample-data-notice"
import type { AnalysisSectionProps } from "@/components/analysis/section-props"
import { toNumber, type ChartTooltipEntry, type ChartTooltipProps } from "@/lib/chart-tooltip"

/** フリー分析のサンプル行（軸1 × 軸2 の集計値） */
interface FreeAnalysisRow {
  axis1Label: string
  axis1Value?: string
  axis2Label?: string
  value: number
}

export function FreeAnalysisSection(_props: AnalysisSectionProps = {}) {
  const [freeAnalysisAxis1, setFreeAnalysisAxis1] = useState<string>("")
  const [freeAnalysisAxis2, setFreeAnalysisAxis2] = useState<string>("")
  const [freeAnalysisMetric, setFreeAnalysisMetric] = useState<string>("")

  // フリー分析用のデータ生成
  const freeAnalysisData = useMemo(() => {
    if (!freeAnalysisAxis1 || !freeAnalysisMetric) return []

    // サンプルデータ（実際の実装では、選択された軸と集計項目に基づいてAPIから取得）
    const sampleData: FreeAnalysisRow[] = []

    // 各軸の値リストを定義
    const axis1Values: Record<string, string[]> = {
      channel: ["公式サイト", "OTA（楽天トラベル）", "OTA（じゃらん）", "電話直接", "公式アプリ"],
      roomtype: ["スタンダードシングル", "スタンダードツイン", "デラックスツイン", "デラックスダブル", "スイート"],
      booking: ["当日", "1-3日前", "4-7日前", "8-14日前", "15-30日前", "31-60日前", "61日以上前"],
      segment: ["ビジネス", "レジャー（個人）", "レジャー（家族）", "団体", "VIP/リピーター"],
      dayofweek: ["月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日", "日曜日"],
      date: Array.from({ length: 14 }, (_, i) => `4/${i + 1}`),
    }

    const axis2Values: Record<string, string[]> = {
      channel: ["公式サイト", "OTA（楽天トラベル）", "OTA（じゃらん）", "電話直接", "公式アプリ"],
      roomtype: ["スタンダードシングル", "スタンダードツイン", "デラックスツイン", "デラックスダブル", "スイート"],
      booking: ["当日", "1-3日前", "4-7日前", "8-14日前", "15-30日前", "31-60日前", "61日以上前"],
      segment: ["ビジネス", "レジャー（個人）", "レジャー（家族）", "団体", "VIP/リピーター"],
      dayofweek: ["月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日", "日曜日"],
    }

    // 集計項目ごとの値の範囲を定義
    const metricRanges: Record<string, { min: number; max: number; multiplier: number }> = {
      rooms: { min: 10, max: 50, multiplier: 1 },
      occupancy: { min: 50, max: 100, multiplier: 1 },
      adr: { min: 15000, max: 30000, multiplier: 1 },
      revpar: { min: 10000, max: 25000, multiplier: 1 },
      revenue: { min: 200000, max: 500000, multiplier: 1 },
      bookings: { min: 10, max: 30, multiplier: 1 },
    }

    const axis1List = axis1Values[freeAnalysisAxis1] || []
    const hasAxis2 = freeAnalysisAxis2 && freeAnalysisAxis2 !== "none"
    const axis2List = hasAxis2 ? (axis2Values[freeAnalysisAxis2] || []) : []
    const metricRange = metricRanges[freeAnalysisMetric] || { min: 0, max: 100, multiplier: 1 }

    // クロス分析の場合
    if (hasAxis2 && axis2List.length > 0) {
      axis1List.forEach((axis1Value, index1) => {
        axis2List.forEach((axis2Value, index2) => {
          // インデックスベースで一貫性のある値を生成（Math.random()の代わりに）
          const seed = (index1 * 1000 + index2 * 100 + freeAnalysisAxis1.length + freeAnalysisAxis2.length) % 1000
          const normalizedValue = (seed / 1000) * (metricRange.max - metricRange.min) + metricRange.min

          let value: number
          if (freeAnalysisMetric === "occupancy") {
            value = Math.round(normalizedValue)
          } else {
            value = Math.round(normalizedValue * metricRange.multiplier)
          }

          sampleData.push({
            axis1Label: axis1Value,
            axis2Label: axis2Value,
            value: value,
          })
        })
      })
    } else {
      // 単一軸分析の場合
      axis1List.forEach((axis1Value, index) => {
        // インデックスベースで一貫性のある値を生成
        const seed = (index * 100 + freeAnalysisAxis1.length) % 1000
        const normalizedValue = (seed / 1000) * (metricRange.max - metricRange.min) + metricRange.min

        let value: number
        if (freeAnalysisMetric === "occupancy") {
          value = Math.round(normalizedValue)
        } else {
          value = Math.round(normalizedValue * metricRange.multiplier)
        }

        sampleData.push({
          axis1Label: axis1Value,
          axis1Value: axis1Value,
          value: value,
        })
      })
    }

    return sampleData
  }, [freeAnalysisAxis1, freeAnalysisAxis2, freeAnalysisMetric])

  const FreeAnalysisTooltip = ({ active, payload }: ChartTooltipProps) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload as FreeAnalysisRow | undefined
      const metricLabel =
        freeAnalysisMetric === "rooms" ? "販売室数" :
          freeAnalysisMetric === "occupancy" ? "稼働率" :
            freeAnalysisMetric === "adr" ? "ADR" :
              freeAnalysisMetric === "revpar" ? "REV-Per" :
                freeAnalysisMetric === "revenue" ? "室料売上" :
                  freeAnalysisMetric === "bookings" ? "予約数" : "値"

      return (
        <div className="bg-background border border-border rounded-lg shadow-lg p-3">
          <p className="text-sm font-medium mb-2">{data?.axis1Label}{data?.axis2Label ? ` × ${data.axis2Label}` : ""}</p>
          <div className="space-y-1">
            {payload.map((entry: ChartTooltipEntry, index: number) => {
              const value = toNumber(entry.value)
              return (
                <p key={index} className="text-xs flex items-center gap-2">
                  <span className="w-3 h-0.5" style={{ backgroundColor: entry.color }}></span>
                  <span>
                    {metricLabel}: {
                      freeAnalysisMetric === "occupancy"
                        ? `${value}%`
                        : freeAnalysisMetric === "adr" || freeAnalysisMetric === "revpar"
                          ? `¥${value.toLocaleString()}`
                          : freeAnalysisMetric === "revenue"
                            ? `¥${value.toLocaleString()}`
                            : `${value}${freeAnalysisMetric === "rooms" ? "室" : ""}`
                    }
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
    <div className="space-y-4">
      <SampleDataNotice detail="フリー分析の集計APIが未実装のため、表示される値はサンプルです。" />
      {/* AI解説を一番上に */}
      <Card className="bg-[color:var(--sky-wash)]/25 border-[color:var(--cyan-edge)]/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <span className="text-xl" aria-hidden>
              🤖
            </span>
            フリー分析インサイト
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-2 text-sm leading-relaxed">
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-[color:var(--positive)] mt-2 flex-shrink-0" />
              <p>
                カスタム分析軸を選択することで、独自の視点からデータを分析できます。複数の軸を組み合わせたクロス分析も可能です。
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-[color:var(--chart-2)] mt-2 flex-shrink-0" />
              <p>
                分析軸1と集計項目を選択すると、自動的にグラフとテーブルが生成されます。分析軸2を追加することで、より詳細なクロス分析が可能です。
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">フリー分析</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">カスタム分析軸を選択して自由に分析</p>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {/* 分析軸選択プルダウン */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="free-analysis-axis1" className="text-xs whitespace-nowrap">分析軸1</Label>
              <Select value={freeAnalysisAxis1} onValueChange={setFreeAnalysisAxis1}>
                <SelectTrigger id="free-analysis-axis1" className="h-8 w-40 text-xs">
                  <SelectValue placeholder="選択してください" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="channel">チャネル</SelectItem>
                  <SelectItem value="roomtype">部屋タイプ</SelectItem>
                  <SelectItem value="booking">予約期間</SelectItem>
                  <SelectItem value="segment">顧客セグメント</SelectItem>
                  <SelectItem value="dayofweek">曜日</SelectItem>
                  <SelectItem value="date">日付</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-1.5">
              <Label htmlFor="free-analysis-axis2" className="text-xs whitespace-nowrap">分析軸2</Label>
              <Select value={freeAnalysisAxis2} onValueChange={setFreeAnalysisAxis2}>
                <SelectTrigger id="free-analysis-axis2" className="h-8 w-40 text-xs">
                  <SelectValue placeholder="なし（単一軸）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">なし（単一軸）</SelectItem>
                  <SelectItem value="channel">チャネル</SelectItem>
                  <SelectItem value="roomtype">部屋タイプ</SelectItem>
                  <SelectItem value="booking">予約期間</SelectItem>
                  <SelectItem value="segment">顧客セグメント</SelectItem>
                  <SelectItem value="dayofweek">曜日</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-1.5">
              <Label htmlFor="free-analysis-metric" className="text-xs whitespace-nowrap">集計項目</Label>
              <Select value={freeAnalysisMetric} onValueChange={setFreeAnalysisMetric}>
                <SelectTrigger id="free-analysis-metric" className="h-8 w-40 text-xs">
                  <SelectValue placeholder="選択してください" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rooms">販売室数</SelectItem>
                  <SelectItem value="occupancy">稼働率</SelectItem>
                  <SelectItem value="adr">ADR</SelectItem>
                  <SelectItem value="revpar">REV-Per</SelectItem>
                  <SelectItem value="revenue">室料売上</SelectItem>
                  <SelectItem value="bookings">予約数</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 分析結果表示 */}
          {freeAnalysisAxis1 && freeAnalysisMetric ? (
            <div className="space-y-4">
              {/* グラフ表示 */}
              {freeAnalysisAxis2 && freeAnalysisAxis2 !== "none" ? (
                // クロス分析の場合はテーブル表示
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-2 font-medium">
                          {freeAnalysisAxis1 === "channel" ? "チャネル" :
                            freeAnalysisAxis1 === "roomtype" ? "部屋タイプ" :
                              freeAnalysisAxis1 === "booking" ? "予約期間" :
                                freeAnalysisAxis1 === "segment" ? "顧客セグメント" :
                                  freeAnalysisAxis1 === "dayofweek" ? "曜日" : "日付"}
                        </th>
                        {Array.from(new Set(freeAnalysisData.map((d) => d.axis2Label).filter((label): label is string => label != null))).map((axis2Label, index) => (
                          <th key={`axis2-${axis2Label}-${index}`} className="text-right py-2 px-2 font-medium">{axis2Label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from(new Set(freeAnalysisData.map((d) => d.axis1Label))).map((axis1Label) => {
                        const rowData = freeAnalysisData.filter((d) => d.axis1Label === axis1Label)
                        return (
                          <tr key={axis1Label} className="border-b hover:bg-muted/50">
                            <td className="py-2 px-2 font-medium">{axis1Label}</td>
                            {Array.from(new Set(freeAnalysisData.map((d) => d.axis2Label).filter((label): label is string => label != null))).map((axis2Label, cellIndex) => {
                              const cellData = rowData.find((d) => d.axis2Label === axis2Label)
                              const value = cellData?.value || 0
                              return (
                                <td key={`cell-${axis1Label}-${axis2Label}-${cellIndex}`} className="text-right py-2 px-2">
                                  {freeAnalysisMetric === "occupancy"
                                    ? `${value}%`
                                    : freeAnalysisMetric === "adr" || freeAnalysisMetric === "revpar"
                                      ? `¥${value.toLocaleString()}`
                                      : freeAnalysisMetric === "revenue"
                                        ? `¥${value.toLocaleString()}`
                                        : `${value}${freeAnalysisMetric === "rooms" ? "室" : ""}`}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                // 単一軸分析の場合はグラフ表示
                <div>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={freeAnalysisData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                      <XAxis
                        dataKey="axis1Label"
                        tick={{ fontSize: 11 }}
                        stroke="currentColor"
                        opacity={0.5}
                        angle={-45}
                        textAnchor="end"
                        height={80}
                      />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        stroke="currentColor"
                        opacity={0.5}
                        label={{
                          value: freeAnalysisMetric === "occupancy" ? "稼働率 (%)" :
                            freeAnalysisMetric === "adr" ? "ADR (¥)" :
                              freeAnalysisMetric === "revpar" ? "REV-Per (¥)" :
                                freeAnalysisMetric === "revenue" ? "室料売上 (¥)" :
                                  freeAnalysisMetric === "rooms" ? "販売室数 (室)" : "予約数",
                          angle: -90,
                          position: "insideLeft",
                          style: { textAnchor: "middle", fontSize: 12 }
                        }}
                      />
                      <Tooltip content={<FreeAnalysisTooltip />} />
                      <Bar
                        dataKey="value"
                        fill="#2563eb"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* テーブル表示（単一軸分析の場合もテーブルを表示） */}
              {(!freeAnalysisAxis2 || freeAnalysisAxis2 === "none") && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 px-2 font-medium">
                          {freeAnalysisAxis1 === "channel" ? "チャネル" :
                            freeAnalysisAxis1 === "roomtype" ? "部屋タイプ" :
                              freeAnalysisAxis1 === "booking" ? "予約期間" :
                                freeAnalysisAxis1 === "segment" ? "顧客セグメント" :
                                  freeAnalysisAxis1 === "dayofweek" ? "曜日" : "日付"}
                        </th>
                        <th className="text-right py-2 px-2 font-medium">
                          {freeAnalysisMetric === "rooms" ? "販売室数" :
                            freeAnalysisMetric === "occupancy" ? "稼働率" :
                              freeAnalysisMetric === "adr" ? "ADR" :
                                freeAnalysisMetric === "revpar" ? "REV-Per" :
                                  freeAnalysisMetric === "revenue" ? "室料売上" :
                                    freeAnalysisMetric === "bookings" ? "予約数" : "値"}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {freeAnalysisData.map((row, index) => (
                        <tr key={index} className="border-b hover:bg-muted/50">
                          <td className="py-2 px-2 font-medium">{row.axis1Label}</td>
                          <td className="text-right py-2 px-2">
                            {freeAnalysisMetric === "occupancy"
                              ? `${row.value}%`
                              : freeAnalysisMetric === "adr" || freeAnalysisMetric === "revpar"
                                ? `¥${row.value.toLocaleString()}`
                                : freeAnalysisMetric === "revenue"
                                  ? `¥${row.value.toLocaleString()}`
                                  : `${row.value}${freeAnalysisMetric === "rooms" ? "室" : ""}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-sm text-muted-foreground">
              分析軸1と集計項目を選択して分析を開始してください
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
