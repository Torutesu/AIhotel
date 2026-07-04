"use client"

import { useState, useMemo, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { Skeleton } from "@/components/ui/skeleton"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts"
import { format } from "date-fns"
import { ja } from "date-fns/locale/ja"
import { CalendarIcon, AlertCircle, RefreshCw } from "lucide-react"

import { Tab } from "@shared/types"
import { useAuth } from "@/components/auth-provider"
import { api, ApiClientError, type DashboardKpi, type AlertItem, type AiSummary } from "@/lib/api"

interface DashboardTabProps {
  onTabChange?: (tab: Tab) => void
}

const now = new Date()

function formatYen(value: number | null | undefined): string {
  if (value == null) return "-"
  return `¥${Math.round(value).toLocaleString()}`
}

function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null) return "-"
  return `${(value * 100).toFixed(digits)}%`
}

function formatRatio(actual: number | null | undefined, target: number | null | undefined): string {
  if (actual == null || target == null || target === 0) return "-"
  return `${((actual / target) * 100).toFixed(1)}%`
}

function ratioNegative(actual: number | null | undefined, target: number | null | undefined): boolean {
  if (actual == null || target == null || target === 0) return false
  return actual / target < 0.95
}

export function DashboardTab({ onTabChange }: DashboardTabProps) {
  const { hotelId } = useAuth()

  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  // 伸び率の高いサイトの表示/非表示設定（設定画面から制御。対応APIがないため表示のみ）
  const [showTopSitesSection, setShowTopSitesSection] = useState(false)

  // 日付比較設定（対応APIがないため参考値表示のまま）
  const [comparisonType, setComparisonType] = useState<"previousDay" | "weekAgo" | "lastMonth" | "custom">("previousDay")
  const [customComparisonDate, setCustomComparisonDate] = useState<Date | undefined>(undefined)

  const [kpi, setKpi] = useState<DashboardKpi | null>(null)
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const [aiSummary, setAiSummary] = useState<AiSummary | null>(null)
  const [totalRooms, setTotalRooms] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const comparisonDate = useMemo(() => {
    const base = new Date()
    switch (comparisonType) {
      case "previousDay": {
        const d = new Date(base)
        d.setDate(d.getDate() - 1)
        return d
      }
      case "weekAgo": {
        const d = new Date(base)
        d.setDate(d.getDate() - 7)
        return d
      }
      case "lastMonth": {
        const d = new Date(base)
        d.setMonth(d.getMonth() - 1)
        return d
      }
      case "custom":
        return customComparisonDate || base
      default:
        return base
    }
  }, [comparisonType, customComparisonDate])

  useEffect(() => {
    const loadSettings = () => {
      if (typeof window !== "undefined") {
        const savedTopSites = localStorage.getItem("dashboard.showTopSitesSection")
        setShowTopSitesSection(savedTopSites === "true")
      }
    }
    loadSettings()
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "dashboard.showTopSitesSection") loadSettings()
    }
    window.addEventListener("storage", handleStorageChange)
    window.addEventListener("settingsUpdated", loadSettings)
    return () => {
      window.removeEventListener("storage", handleStorageChange)
      window.removeEventListener("settingsUpdated", loadSettings)
    }
  }, [])

  const loadData = useCallback(async () => {
    if (!hotelId) return
    setLoading(true)
    setError(null)
    try {
      const [kpiResult, alertsResult, summaryResult, hotels] = await Promise.all([
        api.dashboardKpi(hotelId, year, month),
        api.alerts(hotelId),
        api.aiSummary(hotelId),
        api.hotels(),
      ])
      setKpi(kpiResult)
      setAlerts(alertsResult)
      setAiSummary(summaryResult)
      setTotalRooms(hotels.find((h) => h.id === hotelId)?.totalRooms ?? null)
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "データの取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId, year, month])

  useEffect(() => {
    loadData()
  }, [loadData])

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
        isToday: row.date === todayKey,
      }
    })
  }, [kpi, todayKey])

  // KPI進捗テーブル用の行（実データのみ。バックエンドが提供しない比較値は「-」表示）
  const kpiRows = useMemo(() => {
    if (!kpi) return []
    const { summary, comparison, simulation } = kpi

    return [
      {
        label: "室料売上",
        actual: formatYen(summary.roomRevenue),
        budgetRatio: comparison?.budgetRatioToDate != null ? formatPercent(comparison.budgetRatioToDate) : "-",
        budgetNegative: comparison?.budgetRatioToDate != null && comparison.budgetRatioToDate < 0.95,
        lastYearRatio: comparison?.lastYearRatio != null ? formatPercent(comparison.lastYearRatio) : "-",
        lastYearNegative: comparison?.lastYearRatio != null && comparison.lastYearRatio < 0.95,
        aiPrediction: formatYen(simulation?.projectedRevenue),
        aiBudgetRatio: formatRatio(simulation?.projectedRevenue, comparison?.budgetRevenue),
        aiBudgetNegative: ratioNegative(simulation?.projectedRevenue, comparison?.budgetRevenue),
        aiLastYearRatio: formatRatio(simulation?.projectedRevenue, comparison?.lastYearRevenue),
        aiLastYearNegative: ratioNegative(simulation?.projectedRevenue, comparison?.lastYearRevenue),
      },
      {
        label: "販売室数",
        actual: `${summary.soldRooms.toLocaleString()}室`,
        budgetRatio: "-",
        budgetNegative: false,
        lastYearRatio: "-",
        lastYearNegative: false,
        aiPrediction: "-",
        aiBudgetRatio: "-",
        aiBudgetNegative: false,
        aiLastYearRatio: "-",
        aiLastYearNegative: false,
      },
      {
        label: "ADR",
        actual: formatYen(summary.adr),
        budgetRatio: formatRatio(summary.adr, comparison?.budgetAdr),
        budgetNegative: ratioNegative(summary.adr, comparison?.budgetAdr),
        lastYearRatio: formatRatio(summary.adr, comparison?.lastYearAdr),
        lastYearNegative: ratioNegative(summary.adr, comparison?.lastYearAdr),
        aiPrediction: formatYen(simulation?.projectedAdr),
        aiBudgetRatio: formatRatio(simulation?.projectedAdr, comparison?.budgetAdr),
        aiBudgetNegative: ratioNegative(simulation?.projectedAdr, comparison?.budgetAdr),
        aiLastYearRatio: formatRatio(simulation?.projectedAdr, comparison?.lastYearAdr),
        aiLastYearNegative: ratioNegative(simulation?.projectedAdr, comparison?.lastYearAdr),
      },
      {
        label: "稼働率",
        actual: formatPercent(summary.occupancyRate),
        budgetRatio: formatRatio(summary.occupancyRate, comparison?.budgetOccupancy),
        budgetNegative: ratioNegative(summary.occupancyRate, comparison?.budgetOccupancy),
        lastYearRatio: formatRatio(summary.occupancyRate, comparison?.lastYearOccupancy),
        lastYearNegative: ratioNegative(summary.occupancyRate, comparison?.lastYearOccupancy),
        aiPrediction: formatPercent(simulation?.projectedOccupancy),
        aiBudgetRatio: formatRatio(simulation?.projectedOccupancy, comparison?.budgetOccupancy),
        aiBudgetNegative: ratioNegative(simulation?.projectedOccupancy, comparison?.budgetOccupancy),
        aiLastYearRatio: formatRatio(simulation?.projectedOccupancy, comparison?.lastYearOccupancy),
        aiLastYearNegative: ratioNegative(simulation?.projectedOccupancy, comparison?.lastYearOccupancy),
      },
      {
        label: "REV-Per",
        actual: formatYen(summary.revPar),
        budgetRatio: "-",
        budgetNegative: false,
        lastYearRatio: "-",
        lastYearNegative: false,
        aiPrediction: formatYen(simulation?.projectedRevPar),
        aiBudgetRatio: "-",
        aiBudgetNegative: false,
        aiLastYearRatio: "-",
        aiLastYearNegative: false,
      },
      {
        label: "宿泊人数",
        actual: `${summary.guests.toLocaleString()}人`,
        budgetRatio: "-",
        budgetNegative: false,
        lastYearRatio: "-",
        lastYearNegative: false,
        aiPrediction: "-",
        aiBudgetRatio: "-",
        aiBudgetNegative: false,
        aiLastYearRatio: "-",
        aiLastYearNegative: false,
      },
      {
        label: "DOR",
        actual: `${summary.dor.toFixed(2)}人`,
        budgetRatio: "-",
        budgetNegative: false,
        lastYearRatio: "-",
        lastYearNegative: false,
        aiPrediction: "-",
        aiBudgetRatio: "-",
        aiBudgetNegative: false,
        aiLastYearRatio: "-",
        aiLastYearNegative: false,
      },
      {
        label: "客単価",
        actual: formatYen(summary.guestUnitPrice),
        budgetRatio: "-",
        budgetNegative: false,
        lastYearRatio: "-",
        lastYearNegative: false,
        aiPrediction: "-",
        aiBudgetRatio: "-",
        aiBudgetNegative: false,
        aiLastYearRatio: "-",
        aiLastYearNegative: false,
      },
    ]
  }, [kpi])

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border border-border rounded-lg shadow-lg p-3">
          <p className="text-sm font-medium mb-2">{payload[0].payload.date}</p>
          <div className="space-y-1">
            <p className="text-xs flex items-center gap-2">
              <span className="w-3 h-0.5 bg-blue-600"></span>
              <span>稼働率: {payload[0].value != null ? `${payload[0].value.toFixed(1)}%` : "-"}</span>
            </p>
            <p className="text-xs flex items-center gap-2">
              <span className="w-3 h-0.5 bg-red-500"></span>
              <span>ADR: {payload[1]?.value != null ? `¥${Math.round(payload[1].value).toLocaleString()}` : "-"}</span>
            </p>
          </div>
        </div>
      )
    }
    return null
  }

  const severityBadges: Record<AlertItem["severity"], { border: string; bg: string; dot: string; label: string; text: string }> = {
    RED: {
      border: "border-red-500",
      bg: "bg-red-50 dark:bg-red-950/20",
      dot: "bg-red-500",
      label: "すぐに修正する",
      text: "text-red-700 dark:text-red-400",
    },
    YELLOW: {
      border: "border-yellow-500",
      bg: "bg-yellow-50 dark:bg-yellow-950/20",
      dot: "bg-yellow-500",
      label: "1週間内での経過観察が必要",
      text: "text-yellow-700 dark:text-yellow-400",
    },
  }

  if (!hotelId) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">ホテル情報を読み込んでいます...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4">
        <Card>
          <CardContent className="py-8 flex flex-col items-center gap-3 text-center">
            <AlertCircle className="w-8 h-8 text-destructive" />
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={loadData} className="gap-2">
              <RefreshCw className="w-4 h-4" />
              再試行
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-4">
        {/* 対象年月選択 */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Label className="text-xs whitespace-nowrap">対象年</Label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-24 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}年
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <Label className="text-xs whitespace-nowrap">対象月</Label>
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger className="w-20 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>
                    {i + 1}月
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {totalRooms != null && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded-md ml-auto">
              <p className="text-xs text-muted-foreground">客室数</p>
              <div className="text-lg font-bold">
                {totalRooms.toLocaleString()}
                <span className="text-sm font-semibold ml-0.5">室</span>
              </div>
            </div>
          )}
        </div>

        {/* アラートセクション - 一番上に配置 */}
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-lg font-semibold">アラート</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="space-y-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">現在、対応が必要なアラートはありません。</p>
            ) : (
              <div className="space-y-3">
                {alerts.map((alert) => {
                  const style = severityBadges[alert.severity]
                  return (
                    <div key={alert.id} className={`border-l-4 ${style.border} ${style.bg} p-3 rounded-r`}>
                      <div className="flex items-start gap-2">
                        <div className={`w-3 h-3 rounded-full ${style.dot} mt-1 flex-shrink-0`}></div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className={`text-xs font-semibold ${style.text}`}>{style.label}</span>
                            {alert.linkTab && (
                              <button
                                onClick={() => onTabChange?.(alert.linkTab as Tab)}
                                className="text-xs text-blue-600 hover:underline hover:text-blue-800 transition-colors"
                              >
                                {alert.targetDate ? format(new Date(alert.targetDate), "yyyy/MM/dd") : ""}
                                {alert.linkTab === "pricing" && " (料金設定へ)"}
                                {alert.linkTab === "daily" && " (日別分析へ)"}
                                {alert.linkTab === "analysis" && " (各種分析へ)"}
                              </button>
                            )}
                          </div>
                          <p className={`text-sm ${style.text.replace("700", "800").replace("400", "300")}`}>
                            {alert.title}: {alert.message}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* AI解説セクション */}
        <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200 dark:from-blue-950/30 dark:to-indigo-950/30 dark:border-blue-800">
          <CardHeader className="pb-1">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <span className="text-xl">🤖</span>
              AI解説
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : aiSummary?.content ? (
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{aiSummary.content}</p>
            ) : (
              <p className="text-sm text-muted-foreground">この月のAIまとめはまだ生成されていません。</p>
            )}
          </CardContent>
        </Card>

        {/* 稼働・ADR月間推移 */}
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-lg font-semibold">稼働・ADR月間推移</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : trendChartData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">この月のデータがありません。</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-0.5 bg-blue-600"></div>
                      <span className="font-medium text-xs">稼働率</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-0.5 bg-red-500"></div>
                      <span className="font-medium text-xs">ADR</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="px-1.5 py-0.5 bg-muted rounded text-xs">実績</span>
                    <span>←</span>
                    <span className="px-1.5 py-0.5 bg-muted rounded text-xs">→</span>
                    <span className="px-1.5 py-0.5 bg-muted rounded text-xs">実績+予測</span>
                  </div>
                </div>

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
                      stroke="#2563eb"
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
                      stroke="#2563eb"
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
                      stroke="#ef4444"
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
                      stroke="#ef4444"
                      strokeWidth={2.5}
                      strokeDasharray="5 5"
                      dot={false}
                      name="ADR（予測）"
                      activeDot={{ r: 6 }}
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 月初比較・日付比較セクション（対応APIがないため参考表示） */}
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-lg font-semibold">月初比較・日付比較</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-muted-foreground">月初比較</h3>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">vs {month}月1日</span>
                </div>
                <p className="text-xs text-muted-foreground">この比較機能は今後提供予定です。</p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-muted-foreground">日付比較</h3>
                  <div className="flex items-center gap-2">
                    <Select
                      value={comparisonType}
                      onValueChange={(value: "previousDay" | "weekAgo" | "lastMonth" | "custom") => {
                        setComparisonType(value)
                        if (value !== "custom") {
                          setCustomComparisonDate(undefined)
                        }
                      }}
                    >
                      <SelectTrigger className="w-32 h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="previousDay">前日</SelectItem>
                        <SelectItem value="weekAgo">1週間前</SelectItem>
                        <SelectItem value="lastMonth">先月同日</SelectItem>
                        <SelectItem value="custom">日付選択</SelectItem>
                      </SelectContent>
                    </Select>
                    {comparisonType === "custom" && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" size="sm" className="h-7 text-xs">
                            <CalendarIcon className="mr-1 h-3 w-3" />
                            {customComparisonDate ? format(customComparisonDate, "M/d", { locale: ja }) : "選択"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="end">
                          <Calendar mode="single" selected={customComparisonDate} onSelect={(date) => setCustomComparisonDate(date)} initialFocus />
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  <span className="whitespace-nowrap">vs {format(comparisonDate, "M月d日", { locale: ja })}</span>
                </div>
                <p className="text-xs text-muted-foreground">この比較機能は今後提供予定です。</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 伸び率の高いサイト上位3件（設定で有効化された場合のみ・対応APIなし） */}
        {showTopSitesSection && (
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-lg font-semibold">伸び率の高いサイト上位3件</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-sm text-muted-foreground">この機能は今後提供予定です。</p>
            </CardContent>
          </Card>
        )}

        {/* KPI進捗状況 */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">KPI進捗状況</h2>
            <p className="text-xs text-muted-foreground">
              {kpi ? `${kpi.summary.actualDays}日分の実績を集計` : ""}
            </p>
          </div>

          {loading ? (
            <Skeleton className="h-64 w-full" />
          ) : kpi ? (
            <Card>
              <CardContent className="p-0 pt-2 pb-2">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-center py-1.5 px-2 font-medium border-r">指標</th>
                        <th className="text-center py-1.5 px-2 font-medium border-r">当月実績</th>
                        <th className="text-center py-1.5 px-2 font-medium border-r">予算比</th>
                        <th className="text-center py-1.5 px-2 font-medium border-r">前年比</th>
                        <th className="text-center py-1.5 px-2 font-medium border-r">AI着地予測</th>
                        <th className="text-center py-1.5 px-2 font-medium border-r">対予算(AI)</th>
                        <th className="text-center py-1.5 px-2 font-medium">対前年(AI)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kpiRows.map((row) => (
                        <tr key={row.label} className="border-b hover:bg-muted/20">
                          <td className="py-1.5 px-2 font-medium border-r bg-muted/10">{row.label}</td>
                          <td className="text-right py-1.5 px-2 font-semibold border-r">{row.actual}</td>
                          <td className={`text-right py-1.5 px-2 border-r ${row.budgetNegative ? "text-[color:var(--negative)]" : ""}`}>
                            {row.budgetRatio}
                          </td>
                          <td className={`text-right py-1.5 px-2 border-r ${row.lastYearNegative ? "text-[color:var(--negative)]" : ""}`}>
                            {row.lastYearRatio}
                          </td>
                          <td className="text-right py-1.5 px-2 border-r font-semibold text-green-600 dark:text-green-400">
                            {row.aiPrediction}
                          </td>
                          <td className={`text-right py-1.5 px-2 border-r ${row.aiBudgetNegative ? "text-[color:var(--negative)]" : ""}`}>
                            {row.aiBudgetRatio}
                          </td>
                          <td className={`text-right py-1.5 px-2 ${row.aiLastYearNegative ? "text-[color:var(--negative)]" : ""}`}>
                            {row.aiLastYearRatio}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-muted-foreground">データがありません。</p>
          )}
        </div>
      </div>
    </div>
  )
}
