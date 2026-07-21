"use client"

import { useState, useMemo, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { TrendingUp, AlertCircle, RefreshCw } from "lucide-react"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, BarChart, Bar } from "recharts"
import { AlertTriangle } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { CampaignParticipationManager } from "@/components/campaign-participation-manager"

import { useAuth } from "@/components/auth-provider"
import { api, ApiClientError, type MonthlyTrend, type CompetitorAnalysis } from "@/lib/api"

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function AnalysisTab() {
  const { hotelId } = useAuth()
  const [targetPeriod, setTargetPeriod] = useState("2025-04")
  const [segmentViewMode, setSegmentViewMode] = useState<"guest-count" | "segment">("guest-count")

  // ---- 年間推移（実データ: api.monthlyTrend — F-ANA-03） ----
  const [trendYear, setTrendYear] = useState(() => Number.parseInt(targetPeriod.split("-")[0], 10))
  const [monthlyTrend, setMonthlyTrend] = useState<MonthlyTrend | null>(null)
  const [monthlyTrendLoading, setMonthlyTrendLoading] = useState(true)
  const [monthlyTrendError, setMonthlyTrendError] = useState<string | null>(null)

  const loadMonthlyTrend = useCallback(async () => {
    if (!hotelId) return
    setMonthlyTrendLoading(true)
    setMonthlyTrendError(null)
    try {
      const result = await api.monthlyTrend(hotelId, trendYear)
      setMonthlyTrend(result)
    } catch (err) {
      setMonthlyTrendError(err instanceof ApiClientError ? err.message : "年間推移データの取得に失敗しました")
    } finally {
      setMonthlyTrendLoading(false)
    }
  }, [hotelId, trendYear])

  useEffect(() => {
    loadMonthlyTrend()
  }, [loadMonthlyTrend])

  const monthlyTrendChartData = useMemo(() => {
    if (!monthlyTrend) return []
    return monthlyTrend.months.map((m) => ({
      month: `${m.month}月`,
      revenue: m.hasActuals ? m.revenue : null,
      budget: m.budgetRevenue,
      lastYear: m.lastYearRevenue,
      adr: m.adr,
      occupancy: m.occupancy != null ? Math.round(m.occupancy * 1000) / 10 : null,
      revPar: m.revPar,
    }))
  }, [monthlyTrend])

  const monthlyTrendInsights = useMemo(() => {
    if (!monthlyTrend) return null
    const actualMonths = monthlyTrend.months.filter((m) => m.hasActuals)
    if (actualMonths.length === 0) return null

    const totalRevenue = actualMonths.reduce((sum, m) => sum + m.revenue, 0)
    const budgetedMonths = actualMonths.filter((m) => m.budgetRevenue != null)
    const totalBudget = budgetedMonths.reduce((sum, m) => sum + (m.budgetRevenue ?? 0), 0)
    const achievementRate = budgetedMonths.length > 0 && totalBudget > 0 ? (totalRevenue / totalBudget) * 100 : null

    const bestAdrMonth = actualMonths.reduce<(typeof actualMonths)[number] | null>((best, m) => {
      if (m.adr == null) return best
      if (best == null || (best.adr ?? 0) < m.adr) return m
      return best
    }, null)

    const bestOccMonth = actualMonths.reduce<(typeof actualMonths)[number] | null>((best, m) => {
      if (m.occupancy == null) return best
      if (best == null || (best.occupancy ?? 0) < m.occupancy) return m
      return best
    }, null)

    return { totalRevenue, achievementRate, bestAdrMonth, bestOccMonth }
  }, [monthlyTrend])

  const MonthlyTrendTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border border-border rounded-lg shadow-lg p-3">
          <p className="text-sm font-medium mb-2">{payload[0].payload.month}</p>
          <div className="space-y-1">
            {payload.map((entry: any, index: number) => {
              if (entry.value == null) return null
              const isYen = entry.dataKey !== "occupancy"
              const formatted = isYen
                ? entry.dataKey === "revenue" || entry.dataKey === "budget" || entry.dataKey === "lastYear"
                  ? `¥${(entry.value / 1000000).toFixed(1)}M`
                  : `¥${Math.round(entry.value).toLocaleString()}`
                : `${entry.value}%`
              return (
                <p key={index} className="text-xs flex items-center gap-2">
                  <span className="w-3 h-0.5" style={{ backgroundColor: entry.color }}></span>
                  <span>
                    {entry.name}: {formatted}
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

  // ---- 競合分析（実データ: api.competitorAnalysis — F-ANA-02） ----
  const competitorRange = useMemo(() => {
    const [yearStr, monthStr] = targetPeriod.split("-")
    const year = Number.parseInt(yearStr, 10)
    const month = Number.parseInt(monthStr, 10)
    const start = new Date(year, month - 1, 1)
    const end = new Date(year, month, 0)
    return { startDate: toDateStr(start), endDate: toDateStr(end) }
  }, [targetPeriod])

  const [competitorAnalysis, setCompetitorAnalysis] = useState<CompetitorAnalysis | null>(null)
  const [competitorAnalysisLoading, setCompetitorAnalysisLoading] = useState(true)
  const [competitorAnalysisError, setCompetitorAnalysisError] = useState<string | null>(null)

  const loadCompetitorAnalysis = useCallback(async () => {
    if (!hotelId) return
    setCompetitorAnalysisLoading(true)
    setCompetitorAnalysisError(null)
    try {
      const result = await api.competitorAnalysis(hotelId, competitorRange.startDate, competitorRange.endDate)
      setCompetitorAnalysis(result)
    } catch (err) {
      setCompetitorAnalysisError(err instanceof ApiClientError ? err.message : "競合分析データの取得に失敗しました")
    } finally {
      setCompetitorAnalysisLoading(false)
    }
  }, [hotelId, competitorRange])

  useEffect(() => {
    loadCompetitorAnalysis()
  }, [loadCompetitorAnalysis])

  // フリー分析用のstate
  const [freeAnalysisAxis1, setFreeAnalysisAxis1] = useState<string>("")
  const [freeAnalysisAxis2, setFreeAnalysisAxis2] = useState<string>("")
  const [freeAnalysisMetric, setFreeAnalysisMetric] = useState<string>("")

  const periodData = useMemo(() => {
    const baseMultiplier =
      targetPeriod === "2025-03" ? 0.9 : targetPeriod === "2025-04" ? 1.0 : targetPeriod === "2025-05" ? 1.1 : 1.0

    return {
      channelData: [
        {
          channel: "公式サイト",
          bookings: Math.round(285 * baseMultiplier),
          share: 38.5,
          adr: Math.round(19200 * (0.95 + baseMultiplier * 0.05)),
          revenue: Math.round(5472000 * baseMultiplier),
          growth: 12.3 * baseMultiplier,
          trend: "up",
        },
        {
          channel: "OTA（楽天トラベル）",
          bookings: Math.round(198 * baseMultiplier),
          share: 26.7,
          adr: Math.round(17800 * (0.95 + baseMultiplier * 0.05)),
          revenue: Math.round(3524400 * baseMultiplier),
          growth: 5.8 * baseMultiplier,
          trend: "up",
        },
        {
          channel: "OTA（じゃらん）",
          bookings: Math.round(142 * baseMultiplier),
          share: 19.2,
          adr: Math.round(17200 * (0.95 + baseMultiplier * 0.05)),
          revenue: Math.round(2442400 * baseMultiplier),
          growth: 3.2 * baseMultiplier,
          trend: baseMultiplier > 1 ? "up" : "stable",
        },
        {
          channel: "電話直接",
          bookings: Math.round(68 * baseMultiplier),
          share: 9.2,
          adr: Math.round(21450 * (0.95 + baseMultiplier * 0.05)),
          revenue: Math.round(1458600 * baseMultiplier),
          growth: 8.7 * baseMultiplier,
          trend: "up",
        },
        {
          channel: "公式アプリ",
          bookings: Math.round(48 * baseMultiplier),
          share: 6.5,
          adr: Math.round(18900 * (0.95 + baseMultiplier * 0.05)),
          revenue: Math.round(907200 * baseMultiplier),
          growth: 24.8 * baseMultiplier,
          trend: "up",
        },
      ],
      roomTypeData: [
        {
          type: "スタンダードシングル",
          rooms: 12,
          sold: Math.round(892 * baseMultiplier),
          occ: 82.4 * (0.95 + baseMultiplier * 0.05),
          adr: Math.round(14500 * (0.95 + baseMultiplier * 0.05)),
          revpar: Math.round(11948 * baseMultiplier),
          share: 22.8,
        },
        {
          type: "スタンダードツイン",
          rooms: 10,
          sold: Math.round(768 * baseMultiplier),
          occ: 85.3 * (0.95 + baseMultiplier * 0.05),
          adr: Math.round(18200 * (0.95 + baseMultiplier * 0.05)),
          revpar: Math.round(15523 * baseMultiplier),
          share: 24.6,
        },
        {
          type: "デラックスツイン",
          rooms: 5,
          sold: Math.round(412 * baseMultiplier),
          occ: 91.6 * (0.98 + baseMultiplier * 0.02),
          adr: Math.round(24500 * (0.95 + baseMultiplier * 0.05)),
          revpar: Math.round(22442 * baseMultiplier),
          share: 17.8,
        },
        {
          type: "デラックスダブル",
          rooms: 3,
          sold: Math.round(248 * baseMultiplier),
          occ: 91.9 * (0.98 + baseMultiplier * 0.02),
          adr: Math.round(26800 * (0.95 + baseMultiplier * 0.05)),
          revpar: Math.round(24629 * baseMultiplier),
          share: 11.7,
        },
        {
          type: "スイート",
          rooms: 2,
          sold: Math.round(165 * baseMultiplier),
          occ: 91.7 * (0.98 + baseMultiplier * 0.02),
          adr: Math.round(45000 * (0.95 + baseMultiplier * 0.05)),
          revpar: Math.round(41265 * baseMultiplier),
          share: 13.1,
        },
        {
          type: "プレミアムスイート",
          rooms: 1,
          sold: Math.round(82 * baseMultiplier),
          occ: 91.1 * (0.98 + baseMultiplier * 0.02),
          adr: Math.round(68000 * (0.95 + baseMultiplier * 0.05)),
          revpar: Math.round(61948 * baseMultiplier),
          share: 9.8,
        },
      ],
      bookingWindowData: [
        {
          window: "当日",
          bookings: Math.round(45 * baseMultiplier),
          share: 6.1,
          adr: Math.round(15200 * (0.95 + baseMultiplier * 0.05)),
          cancel: 2.2,
          growth: -3.5 * baseMultiplier,
        },
        {
          window: "1-3日前",
          bookings: Math.round(98 * baseMultiplier),
          share: 13.2,
          adr: Math.round(16800 * (0.95 + baseMultiplier * 0.05)),
          cancel: 3.8,
          growth: 5.2 * baseMultiplier,
        },
        {
          window: "4-7日前",
          bookings: Math.round(156 * baseMultiplier),
          share: 21.1,
          adr: Math.round(18200 * (0.95 + baseMultiplier * 0.05)),
          cancel: 4.5,
          growth: 8.7 * baseMultiplier,
        },
        {
          window: "8-14日前",
          bookings: Math.round(189 * baseMultiplier),
          share: 25.5,
          adr: Math.round(19100 * (0.95 + baseMultiplier * 0.05)),
          cancel: 5.2,
          growth: 12.3 * baseMultiplier,
        },
        {
          window: "15-30日前",
          bookings: Math.round(168 * baseMultiplier),
          share: 22.7,
          adr: Math.round(19800 * (0.95 + baseMultiplier * 0.05)),
          cancel: 6.8,
          growth: 15.8 * baseMultiplier,
        },
        {
          window: "31-60日前",
          bookings: Math.round(62 * baseMultiplier),
          share: 8.4,
          adr: Math.round(20500 * (0.95 + baseMultiplier * 0.05)),
          cancel: 8.5,
          growth: 18.2 * baseMultiplier,
        },
        {
          window: "61日以上前",
          bookings: Math.round(23 * baseMultiplier),
          share: 3.1,
          adr: Math.round(21200 * (0.95 + baseMultiplier * 0.05)),
          cancel: 12.1,
          growth: 22.5 * baseMultiplier,
        },
      ],
      segmentData: [
        {
          segment: "ビジネス",
          bookings: Math.round(312 * baseMultiplier),
          share: 42.1,
          adr: Math.round(16800 * (0.95 + baseMultiplier * 0.05)),
          nights: 1.2,
          ltv: Math.round(52800 * baseMultiplier),
        },
        {
          segment: "レジャー（個人）",
          bookings: Math.round(245 * baseMultiplier),
          share: 33.1,
          adr: Math.round(21200 * (0.95 + baseMultiplier * 0.05)),
          nights: 2.1,
          ltv: Math.round(93912 * baseMultiplier),
        },
        {
          segment: "レジャー（家族）",
          bookings: Math.round(98 * baseMultiplier),
          share: 13.2,
          adr: Math.round(24500 * (0.95 + baseMultiplier * 0.05)),
          nights: 2.8,
          ltv: Math.round(137200 * baseMultiplier),
        },
        {
          segment: "団体",
          bookings: Math.round(52 * baseMultiplier),
          share: 7.0,
          adr: Math.round(18900 * (0.95 + baseMultiplier * 0.05)),
          nights: 1.5,
          ltv: Math.round(56700 * baseMultiplier),
        },
        {
          segment: "VIP/リピーター",
          bookings: Math.round(34 * baseMultiplier),
          share: 4.6,
          adr: Math.round(28500 * (0.95 + baseMultiplier * 0.05)),
          nights: 2.5,
          ltv: Math.round(178500 * baseMultiplier),
        },
      ],
      guestCountData: [
        {
          guestCount: "1名",
          bookings: Math.round(312 * baseMultiplier),
          share: 42.1,
          adr: Math.round(16800 * (0.95 + baseMultiplier * 0.05)),
          nights: 1.2,
          ltv: Math.round(52800 * baseMultiplier),
          unitPrice: Math.round(16800 * (0.95 + baseMultiplier * 0.05)),
        },
        {
          guestCount: "2名",
          bookings: Math.round(245 * baseMultiplier),
          share: 33.1,
          adr: Math.round(21200 * (0.95 + baseMultiplier * 0.05)),
          nights: 2.1,
          ltv: Math.round(93912 * baseMultiplier),
          unitPrice: Math.round(21200 * (0.95 + baseMultiplier * 0.05) / 2),
        },
        {
          guestCount: "3名",
          bookings: Math.round(98 * baseMultiplier),
          share: 13.2,
          adr: Math.round(24500 * (0.95 + baseMultiplier * 0.05)),
          nights: 2.8,
          ltv: Math.round(137200 * baseMultiplier),
          unitPrice: Math.round(24500 * (0.95 + baseMultiplier * 0.05) / 3),
        },
        {
          guestCount: "4名以上",
          bookings: Math.round(52 * baseMultiplier),
          share: 7.0,
          adr: Math.round(18900 * (0.95 + baseMultiplier * 0.05)),
          nights: 1.5,
          ltv: Math.round(56700 * baseMultiplier),
          unitPrice: Math.round(18900 * (0.95 + baseMultiplier * 0.05) / 4),
        },
      ],
    }
  }, [targetPeriod])

  const ComparisonTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border border-border rounded-lg shadow-lg p-3">
          <p className="text-sm font-medium mb-2">{payload[0].payload.month}</p>
          <div className="space-y-1">
            {payload.map((entry: any, index: number) => (
              <p key={index} className="text-xs flex items-center gap-2">
                <span className="w-3 h-0.5" style={{ backgroundColor: entry.color }}></span>
                <span>
                  {entry.name}:{" "}
                  {entry.dataKey === "revenue" || entry.dataKey === "budget" || entry.dataKey === "lastYear"
                    ? `¥${(entry.value / 1000000).toFixed(1)}M`
                    : entry.dataKey === "adr"
                      ? `¥${Math.round(entry.value).toLocaleString()}`
                      : `${Math.round(entry.value)}%`}
                </span>
              </p>
            ))}
          </div>
        </div>
      )
    }
    return null
  }

  // フリー分析用のデータ生成
  const freeAnalysisData = useMemo(() => {
    if (!freeAnalysisAxis1 || !freeAnalysisMetric) return []

    // サンプルデータ（実際の実装では、選択された軸と集計項目に基づいてAPIから取得）
    const sampleData: any[] = []

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

  const FreeAnalysisTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload
      const metricLabel =
        freeAnalysisMetric === "rooms" ? "販売室数" :
          freeAnalysisMetric === "occupancy" ? "稼働率" :
            freeAnalysisMetric === "adr" ? "ADR" :
              freeAnalysisMetric === "revpar" ? "RevPAR" :
                freeAnalysisMetric === "revenue" ? "室料売上" :
                  freeAnalysisMetric === "bookings" ? "予約数" : "値"

      return (
        <div className="bg-background border border-border rounded-lg shadow-lg p-3">
          <p className="text-sm font-medium mb-2">{data.axis1Label}{data.axis2Label ? ` × ${data.axis2Label}` : ""}</p>
          <div className="space-y-1">
            {payload.map((entry: any, index: number) => (
              <p key={index} className="text-xs flex items-center gap-2">
                <span className="w-3 h-0.5" style={{ backgroundColor: entry.color }}></span>
                <span>
                  {metricLabel}: {
                    freeAnalysisMetric === "occupancy"
                      ? `${entry.value}%`
                      : freeAnalysisMetric === "adr" || freeAnalysisMetric === "revpar"
                        ? `¥${entry.value.toLocaleString()}`
                        : freeAnalysisMetric === "revenue"
                          ? `¥${entry.value.toLocaleString()}`
                          : `${entry.value}${freeAnalysisMetric === "rooms" ? "室" : ""}`
                  }
                </span>
              </p>
            ))}
          </div>
        </div>
      )
    }
    return null
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold text-balance">各種分析</h2>
        <p className="text-sm text-muted-foreground mt-1">多角的な収益分析とインサイト</p>
      </div>

      {/* Analysis Tabs */}
      <Tabs defaultValue="channel" className="space-y-4">
        {/* Period SelectorとTabsListを1つのCardに統合 */}
        <Card>
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Label htmlFor="period" className="text-sm whitespace-nowrap">対象期間</Label>
                <Select value={targetPeriod} onValueChange={setTargetPeriod}>
                  <SelectTrigger id="period" className="h-9 w-40 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2025-03">2025年3月</SelectItem>
                    <SelectItem value="2025-04">2025年4月</SelectItem>
                    <SelectItem value="2025-05">2025年5月</SelectItem>
                    <SelectItem value="2025-06">2025年6月</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <TabsList className="h-9 inline-flex">
                <TabsTrigger value="channel" className="text-sm px-4 py-2">チャネル分析</TabsTrigger>
                <TabsTrigger value="roomtype" className="text-sm px-4 py-2">部屋タイプ分析</TabsTrigger>
                <TabsTrigger value="booking" className="text-sm px-4 py-2">予約期間分析</TabsTrigger>
                <TabsTrigger value="segment" className="text-sm px-4 py-2">顧客セグメント</TabsTrigger>
                <TabsTrigger value="competitor" className="text-sm px-4 py-2">競合価格</TabsTrigger>
                <TabsTrigger value="comparison" className="text-sm px-4 py-2">年間推移</TabsTrigger>
                <TabsTrigger value="free" className="text-sm px-4 py-2">フリー分析</TabsTrigger>
              </TabsList>
            </div>
          </CardContent>
        </Card>

        {/* Channel Analysis */}
        <TabsContent value="channel" className="space-y-4">
          {/* AI解説を一番上に */}
          <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <span className="text-xl">🤖</span>
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
              <CardTitle className="text-base">チャネル別パフォーマンス</CardTitle>
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

        </TabsContent>

        {/* Room Type Analysis */}
        <TabsContent value="roomtype" className="space-y-4">
          {/* AI解説を一番上に */}
          <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <span className="text-xl">🤖</span>
                部屋タイプ分析インサイト
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-2 text-sm leading-relaxed">
                <div className="flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-[color:var(--positive)] mt-2 flex-shrink-0" />
                  <p>
                    デラックス以上の客室は稼働率91%超と非常に高く、需要が供給を上回っています。価格引き上げの余地があります。
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-[color:var(--chart-2)] mt-2 flex-shrink-0" />
                  <p>
                    スタンダードシングルの稼働率が82.4%とやや低めです。ビジネス客向けプロモーションの強化を推奨します。
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-[color:var(--positive)] mt-2 flex-shrink-0" />
                  <p>
                    プレミアムスイートのRevPARが¥61,948と最も高く、収益性の高い客室タイプです。
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">部屋タイプ別パフォーマンス</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-4 font-medium">部屋タイプ</th>
                      <th className="text-right py-3 px-4 font-medium">客室数</th>
                      <th className="text-right py-3 px-4 font-medium">販売室数</th>
                      <th className="text-right py-3 px-4 font-medium">稼働率</th>
                      <th className="text-right py-3 px-4 font-medium">ADR</th>
                      <th className="text-right py-3 px-4 font-medium">RevPAR</th>
                      <th className="text-right py-3 px-4 font-medium">売上構成比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {periodData.roomTypeData.map((row) => (
                      <tr key={row.type} className="border-b hover:bg-muted/50">
                        <td className="py-3 px-4 font-medium">{row.type}</td>
                        <td className="text-right py-3 px-4">{row.rooms}室</td>
                        <td className="text-right py-3 px-4">{row.sold}室</td>
                        <td className="text-right py-3 px-4">
                          <span
                            className={
                              row.occ >= 90
                                ? "text-[color:var(--positive)] font-medium"
                                : row.occ < 80
                                  ? "text-[color:var(--negative)]"
                                  : ""
                            }
                          >
                            {row.occ.toFixed(1)}%
                          </span>
                        </td>
                        <td className="text-right py-3 px-4">¥{row.adr.toLocaleString()}</td>
                        <td className="text-right py-3 px-4 font-medium">¥{row.revpar.toLocaleString()}</td>
                        <td className="text-right py-3 px-4">{row.share.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

        </TabsContent>

        {/* Booking Window Analysis */}
        <TabsContent value="booking" className="space-y-6">
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
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-[color:var(--chart-3)]">
            <CardHeader>
              <CardTitle className="text-lg">予約期間分析インサイト</CardTitle>
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
        </TabsContent>

        {/* Customer Segment Analysis */}
        <TabsContent value="segment" className="space-y-6">
          {/* AI解説を一番上に */}
          <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <span className="text-xl">🤖</span>
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
                  <CardTitle className="text-base">利用人数別パフォーマンス</CardTitle>
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
                <CardTitle className="text-base">顧客セグメント別パフォーマンス</CardTitle>
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

        </TabsContent>

        {/* Competitor Price Analysis */}
        <TabsContent value="competitor" className="space-y-6">
          {/* 注意事項アラート */}
          <Alert className="bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <AlertTitle className="text-sm font-semibold text-amber-900 dark:text-amber-100">データ取り扱いに関する注意事項</AlertTitle>
            <AlertDescription className="text-xs text-amber-800 dark:text-amber-200 mt-1 space-y-1">
              <p>• 競合データは参考値であり、実際の価格設定には複数の要因（立地、設備、サービス品質等）を総合的に考慮してください。</p>
              <p>• 対象期間: {competitorRange.startDate} 〜 {competitorRange.endDate}（上部の対象期間セレクタで選択した月）</p>
            </AlertDescription>
          </Alert>

          {competitorAnalysisLoading ? (
            <Card>
              <CardContent className="py-8">
                <Skeleton className="h-64 w-full" />
              </CardContent>
            </Card>
          ) : competitorAnalysisError ? (
            <Card>
              <CardContent className="py-8 flex flex-col items-center gap-3 text-center">
                <AlertCircle className="w-8 h-8 text-destructive" />
                <p className="text-sm text-muted-foreground">{competitorAnalysisError}</p>
                <Button variant="outline" size="sm" onClick={loadCompetitorAnalysis} className="gap-2">
                  <RefreshCw className="w-4 h-4" />
                  再試行
                </Button>
              </CardContent>
            </Card>
          ) : !competitorAnalysis || competitorAnalysis.competitors.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                対象期間の競合データが登録されていません。
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Card>
                  <CardContent className="py-2.5 px-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1">競合ホテル数</p>
                    <div className="text-lg font-semibold mb-0.5">{competitorAnalysis.competitors.length}件</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="py-2.5 px-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1">競合平均価格（全体）</p>
                    <div className="text-lg font-semibold mb-0.5">
                      {(() => {
                        const avgs = competitorAnalysis.competitors.map((c) => c.avgPrice).filter((v): v is number => v != null)
                        if (avgs.length === 0) return "-"
                        return `¥${Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length).toLocaleString()}`
                      })()}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="py-2.5 px-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1">対象期間</p>
                    <div className="text-sm font-semibold mb-0.5">
                      {competitorAnalysis.startDate} 〜 {competitorAnalysis.endDate}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">競合ホテル別平均価格</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">対象期間中の1名料金の平均値</p>
                </CardHeader>
                <CardContent className="pt-0">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart
                      data={competitorAnalysis.competitors.map((c) => ({ name: c.name, avgPrice: c.avgPrice ?? 0 }))}
                      margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.5} />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        stroke="currentColor"
                        opacity={0.5}
                        tickFormatter={(value) => `¥${(value / 1000).toFixed(0)}k`}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const value = payload[0].value as number
                            return (
                              <div className="bg-background border border-border rounded-lg shadow-lg p-3">
                                <p className="text-sm font-medium mb-2">{payload[0].payload.name}</p>
                                <p className="text-xs">平均価格: ¥{value.toLocaleString()}</p>
                              </div>
                            )
                          }
                          return null
                        }}
                      />
                      <Bar dataKey="avgPrice" fill="#2563eb" radius={[4, 4, 0, 0]} name="平均価格" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">競合ホテル一覧</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 px-2 font-medium">ホテル名</th>
                          <th className="text-left py-2 px-2 font-medium">カテゴリ</th>
                          <th className="text-right py-2 px-2 font-medium">サンプル数</th>
                          <th className="text-right py-2 px-2 font-medium">最低価格</th>
                          <th className="text-right py-2 px-2 font-medium">最高価格</th>
                          <th className="text-right py-2 px-2 font-medium">平均価格</th>
                        </tr>
                      </thead>
                      <tbody>
                        {competitorAnalysis.competitors.map((c) => (
                          <tr key={c.id} className="border-b hover:bg-muted/50">
                            <td className="py-2 px-2 font-medium">{c.name}</td>
                            <td className="py-2 px-2">{c.category ?? "-"}</td>
                            <td className="text-right py-2 px-2">{c.sampleSize}件</td>
                            <td className="text-right py-2 px-2">{c.minPrice != null ? `¥${c.minPrice.toLocaleString()}` : "-"}</td>
                            <td className="text-right py-2 px-2">{c.maxPrice != null ? `¥${c.maxPrice.toLocaleString()}` : "-"}</td>
                            <td className="text-right py-2 px-2 font-medium">{c.avgPrice != null ? `¥${c.avgPrice.toLocaleString()}` : "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="comparison" className="space-y-6">
          <Card>
            <CardContent className="py-3 px-4">
              <div className="flex items-center gap-2">
                <Label htmlFor="trend-year" className="text-sm whitespace-nowrap">対象年</Label>
                <Select value={String(trendYear)} onValueChange={(v) => setTrendYear(Number.parseInt(v, 10))}>
                  <SelectTrigger id="trend-year" className="h-9 w-32 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[trendYear - 1, trendYear, trendYear + 1].map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}年
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {monthlyTrendLoading ? (
            <Card>
              <CardContent className="py-8">
                <Skeleton className="h-64 w-full" />
              </CardContent>
            </Card>
          ) : monthlyTrendError ? (
            <Card>
              <CardContent className="py-8 flex flex-col items-center gap-3 text-center">
                <AlertCircle className="w-8 h-8 text-destructive" />
                <p className="text-sm text-muted-foreground">{monthlyTrendError}</p>
                <Button variant="outline" size="sm" onClick={loadMonthlyTrend} className="gap-2">
                  <RefreshCw className="w-4 h-4" />
                  再試行
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>売上推移比較</CardTitle>
                    <p className="text-sm text-muted-foreground">実績 vs 予算 vs 前年</p>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={320}>
                      <LineChart data={monthlyTrendChartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.5} />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          stroke="currentColor"
                          opacity={0.5}
                          tickFormatter={(value) => `¥${(value / 1000000).toFixed(0)}M`}
                        />
                        <Tooltip content={<MonthlyTrendTooltip />} />
                        <Legend wrapperStyle={{ fontSize: "12px" }} />
                        <Line
                          type="monotone"
                          dataKey="revenue"
                          stroke="var(--positive)"
                          strokeWidth={3}
                          dot={{ r: 4 }}
                          name="実績"
                          connectNulls={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="budget"
                          stroke="currentColor"
                          strokeOpacity={0.4}
                          strokeWidth={2}
                          strokeDasharray="5 5"
                          dot={false}
                          name="予算"
                          connectNulls={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="lastYear"
                          stroke="var(--chart-2)"
                          strokeWidth={2}
                          dot={{ r: 3 }}
                          name="前年"
                          connectNulls={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>ADR推移</CardTitle>
                    <p className="text-sm text-muted-foreground">平均客室単価の推移</p>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={320}>
                      <LineChart data={monthlyTrendChartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.5} />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          stroke="currentColor"
                          opacity={0.5}
                          tickFormatter={(value) => `¥${(value / 1000).toFixed(0)}k`}
                        />
                        <Tooltip content={<MonthlyTrendTooltip />} />
                        <Line
                          type="monotone"
                          dataKey="adr"
                          stroke="var(--chart-3)"
                          strokeWidth={3}
                          dot={{ r: 4 }}
                          name="ADR"
                          connectNulls={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>稼働率推移</CardTitle>
                    <p className="text-sm text-muted-foreground">客室稼働率の推移</p>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={320}>
                      <LineChart data={monthlyTrendChartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.5} />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          stroke="currentColor"
                          opacity={0.5}
                          domain={[0, 100]}
                          tickFormatter={(value) => `${value}%`}
                        />
                        <Tooltip content={<MonthlyTrendTooltip />} />
                        <Line
                          type="monotone"
                          dataKey="occupancy"
                          stroke="var(--chart-4)"
                          strokeWidth={3}
                          dot={{ r: 4 }}
                          name="稼働率"
                          connectNulls={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>RevPAR推移</CardTitle>
                    <p className="text-sm text-muted-foreground">客室あたり収益の推移</p>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={320}>
                      <LineChart data={monthlyTrendChartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.5} />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          stroke="currentColor"
                          opacity={0.5}
                          tickFormatter={(value) => `¥${(value / 1000).toFixed(0)}k`}
                        />
                        <Tooltip content={<MonthlyTrendTooltip />} />
                        <Line
                          type="monotone"
                          dataKey="revPar"
                          stroke="var(--positive)"
                          strokeWidth={3}
                          dot={{ r: 4 }}
                          name="RevPAR"
                          connectNulls={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              {monthlyTrendInsights && (
                <Card className="border-l-4 border-l-primary">
                  <CardHeader>
                    <CardTitle className="text-lg">{trendYear}年 実績サマリー</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="w-2 h-2 rounded-full bg-[color:var(--positive)] mt-2" />
                      <p className="text-sm leading-relaxed">
                        実績のある月の累計売上は¥{Math.round(monthlyTrendInsights.totalRevenue / 1000000).toLocaleString()}Mで、
                        {monthlyTrendInsights.achievementRate != null
                          ? `同期間の予算比 ${monthlyTrendInsights.achievementRate.toFixed(1)}% です。`
                          : "予算データが未登録のため予算比は算出できません。"}
                      </p>
                    </div>
                    {monthlyTrendInsights.bestAdrMonth && (
                      <div className="flex items-start gap-3">
                        <div className="w-2 h-2 rounded-full bg-[color:var(--chart-2)] mt-2" />
                        <p className="text-sm leading-relaxed">
                          ADRが最も高いのは{monthlyTrendInsights.bestAdrMonth.month}月（¥
                          {monthlyTrendInsights.bestAdrMonth.adr?.toLocaleString()}）でした。
                        </p>
                      </div>
                    )}
                    {monthlyTrendInsights.bestOccMonth && (
                      <div className="flex items-start gap-3">
                        <div className="w-2 h-2 rounded-full bg-[color:var(--positive)] mt-2" />
                        <p className="text-sm leading-relaxed">
                          稼働率が最も高いのは{monthlyTrendInsights.bestOccMonth.month}月（
                          {monthlyTrendInsights.bestOccMonth.occupancy != null
                            ? `${(monthlyTrendInsights.bestOccMonth.occupancy * 100).toFixed(1)}%`
                            : "-"}
                          ）でした。
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* Free Analysis */}
        <TabsContent value="free" className="space-y-4">
          {/* AI解説を一番上に */}
          <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <span className="text-xl">🤖</span>
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
              <CardTitle className="text-base">フリー分析</CardTitle>
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
                      <SelectItem value="revpar">RevPAR</SelectItem>
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
                            {Array.from(new Set(freeAnalysisData.map((d: any) => d.axis2Label).filter((label: any) => label != null))).map((axis2Label: any, index: number) => (
                              <th key={`axis2-${axis2Label}-${index}`} className="text-right py-2 px-2 font-medium">{axis2Label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {Array.from(new Set(freeAnalysisData.map((d: any) => d.axis1Label))).map((axis1Label: any) => {
                            const rowData = freeAnalysisData.filter((d: any) => d.axis1Label === axis1Label)
                            return (
                              <tr key={axis1Label} className="border-b hover:bg-muted/50">
                                <td className="py-2 px-2 font-medium">{axis1Label}</td>
                                {Array.from(new Set(freeAnalysisData.map((d: any) => d.axis2Label).filter((label: any) => label != null))).map((axis2Label: any, cellIndex: number) => {
                                  const cellData = rowData.find((d: any) => d.axis2Label === axis2Label)
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
                                  freeAnalysisMetric === "revpar" ? "RevPAR (¥)" :
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
                                    freeAnalysisMetric === "revpar" ? "RevPAR" :
                                      freeAnalysisMetric === "revenue" ? "室料売上" :
                                        freeAnalysisMetric === "bookings" ? "予約数" : "値"}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {freeAnalysisData.map((row: any, index: number) => (
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
        </TabsContent>
      </Tabs>

      {/* OTA販売促進参画データ管理セクション */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold">OTA販売促進参画データ管理</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <CampaignParticipationManager />
        </CardContent>
      </Card>
    </div>
  )
}
