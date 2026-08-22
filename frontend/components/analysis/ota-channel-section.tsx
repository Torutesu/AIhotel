"use client"

// OTAチャネル実績集計セクション（分析タブ）
// OtaChannelData（seed / Excel取込）をチャネル別に集計して表示する。
// OTAサイトからの自動取得（スクレイピング）はPhase 4のため未実装。
// 「他社（OTA共通販促）の情報を元に見る」ためキャンペーン参画日数も表示する。

import { useState, useEffect, useCallback, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { AlertCircle, RefreshCw, Globe } from "lucide-react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import { useAuth } from "@/components/auth-provider"
import { api, ApiClientError, type OtaChannelSummary } from "@/lib/api"

const CHANNEL_COLORS = [
  "var(--chart-1, #2563eb)",
  "var(--chart-2, #16a34a)",
  "var(--chart-3, #f59e0b)",
  "var(--chart-4, #dc2626)",
  "var(--chart-5, #7c3aed)",
  "#0891b2",
  "#be185d",
]

function currentMonthStr(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

export function OtaChannelSection() {
  const { hotelId } = useAuth()
  const [targetMonth, setTargetMonth] = useState(currentMonthStr)
  const [summary, setSummary] = useState<OtaChannelSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!hotelId) return
    const [year, month] = targetMonth.split("-").map(Number)
    if (!year || !month) return
    setLoading(true)
    setError(null)
    try {
      setSummary(await api.otaChannelSummary(hotelId, year, month))
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "OTAチャネル実績の取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId, targetMonth])

  useEffect(() => {
    load()
  }, [load])

  // 日別×チャネルの行を積み上げグラフ用にピボットする
  const { chartData, channelNames } = useMemo(() => {
    if (!summary) return { chartData: [], channelNames: [] as string[] }
    const names = summary.channels.map((c) => c.channel)
    const byDate = new Map<string, Record<string, number | string>>()
    for (const row of summary.daily) {
      const entry = byDate.get(row.date) ?? { date: row.date.slice(8, 10) + "日" }
      entry[row.channel] = row.roomsSold
      byDate.set(row.date, entry)
    }
    return { chartData: [...byDate.values()], channelNames: names }
  }, [summary])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Globe className="w-4 h-4" />
              OTAチャネル別実績集計
            </CardTitle>
            <CardDescription className="mt-1">
              チャネル別の販売室数・売上・ADR・シェアとキャンペーン参画状況を集計します（データは手動取込。自動取得はPhase 4）
            </CardDescription>
          </div>
          <div className="flex items-center gap-1.5">
            <Label htmlFor="ota-month" className="text-xs whitespace-nowrap text-muted-foreground">
              対象月
            </Label>
            <input
              id="ota-month"
              type="month"
              value={targetMonth}
              onChange={(e) => setTargetMonth(e.target.value)}
              className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Skeleton className="h-64 w-full" />
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertCircle className="w-6 h-6 text-destructive" />
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={load} className="gap-2">
              <RefreshCw className="w-4 h-4" />
              再試行
            </Button>
          </div>
        ) : !summary || summary.channels.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            この月のOTAチャネル実績データがありません。設定タブの「Excelデータ取込」からアップロードできます。
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">販売室数合計</div>
                <div className="text-lg font-semibold">{summary.totals.roomsSold.toLocaleString()}室</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">売上合計</div>
                <div className="text-lg font-semibold">¥{summary.totals.revenue.toLocaleString()}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">全体ADR</div>
                <div className="text-lg font-semibold">
                  {summary.totals.adr != null ? `¥${summary.totals.adr.toLocaleString()}` : "-"}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium">チャネル</th>
                    <th className="text-right py-2 px-3 font-medium">販売室数</th>
                    <th className="text-right py-2 px-3 font-medium">室数シェア</th>
                    <th className="text-right py-2 px-3 font-medium">売上</th>
                    <th className="text-right py-2 px-3 font-medium">ADR</th>
                    <th className="text-center py-2 px-3 font-medium">キャンペーン参画</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.channels.map((c, i) => (
                    <tr key={c.channel} className="border-b hover:bg-muted/50">
                      <td className="py-2 px-3">
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-sm inline-block"
                            style={{ backgroundColor: CHANNEL_COLORS[i % CHANNEL_COLORS.length] }}
                          />
                          {c.channel}
                        </span>
                      </td>
                      <td className="text-right py-2 px-3">{c.roomsSold.toLocaleString()}</td>
                      <td className="text-right py-2 px-3">
                        {c.roomsShare != null ? `${(c.roomsShare * 100).toFixed(1)}%` : "-"}
                      </td>
                      <td className="text-right py-2 px-3">¥{c.revenue.toLocaleString()}</td>
                      <td className="text-right py-2 px-3">
                        {c.adr != null ? `¥${c.adr.toLocaleString()}` : "-"}
                      </td>
                      <td className="text-center py-2 px-3">
                        {c.campaignDays > 0 ? (
                          <Badge variant="secondary" className="text-[10px]">
                            {c.campaignDays}日参画
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <p className="text-xs text-muted-foreground mb-2">日別販売室数（チャネル別積み上げ）</p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} width={40} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {channelNames.map((name, i) => (
                      <Bar
                        key={name}
                        dataKey={name}
                        stackId="rooms"
                        fill={CHANNEL_COLORS[i % CHANNEL_COLORS.length]}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
