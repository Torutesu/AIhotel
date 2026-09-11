"use client"

// 年間推移（U-15 で analysis-tab.tsx から分割）。GET /analysis/monthly の実データ。

import { useCallback, useEffect, useMemo, useState } from "react"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorCard } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { useTargetPeriod, type AnalysisSectionProps } from "@/components/analysis/section-props"
import { api, ApiClientError, type MonthlyTrend } from "@/lib/api"
import { toNumber, type ChartTooltipEntry, type ChartTooltipProps } from "@/lib/chart-tooltip"

export function YearlyTrendSection(props: AnalysisSectionProps) {
  const { hotelId } = useAuth()
  const { targetPeriod } = useTargetPeriod(props)

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

  const MonthlyTrendTooltip = ({ active, payload }: ChartTooltipProps) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border border-border rounded-lg shadow-lg p-3">
          <p className="text-sm font-medium mb-2">{payload[0].payload?.month}</p>
          <div className="space-y-1">
            {payload.map((entry: ChartTooltipEntry, index: number) => {
              if (entry.value == null) return null
              const value = toNumber(entry.value)
              const isYen = entry.dataKey !== "occupancy"
              const formatted = isYen
                ? entry.dataKey === "revenue" || entry.dataKey === "budget" || entry.dataKey === "lastYear"
                  ? `¥${(value / 1000000).toFixed(1)}M`
                  : `¥${Math.round(value).toLocaleString()}`
                : `${value}%`
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

  return (
    <div className="space-y-6">
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
        <ErrorCard message={monthlyTrendError} onRetry={loadMonthlyTrend} />
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
                <CardTitle>REV-Per推移</CardTitle>
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
                      name="REV-Per"
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
                <CardTitle className="text-base font-medium">{trendYear}年 実績サマリー</CardTitle>
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
    </div>
  )
}
