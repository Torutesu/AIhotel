"use client"

// 当月着地予測セクション（分析タブ — F-DP-04「着地遷移」）
// 実績済みの日は実績、未実績の日はAI予測で埋めた累計売上のトラジェクトリを表示し、
// 「残室や記入に対して今月どのように着地するのか」を可視化する。

import { useState, useEffect, useCallback, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertCircle, RefreshCw, Flag } from "lucide-react"
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import { useAuth } from "@/components/auth-provider"
import { api, ApiClientError, type LandingForecast } from "@/lib/api"

function currentMonthStr(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

const yenM = (v: number) => `¥${(v / 1_000_000).toFixed(1)}M`

export function LandingForecastSection() {
  const { hotelId } = useAuth()
  const [targetMonth, setTargetMonth] = useState(currentMonthStr)
  const [data, setData] = useState<LandingForecast | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!hotelId) return
    const [year, month] = targetMonth.split("-").map(Number)
    if (!year || !month) return
    setLoading(true)
    setError(null)
    try {
      setData(await api.landingForecast(hotelId, year, month))
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "着地予測の取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId, targetMonth])

  useEffect(() => {
    load()
  }, [load])

  const chartData = useMemo(() => {
    if (!data) return []
    return data.trajectory.map((t) => ({
      date: `${Number(t.date.slice(8, 10))}日`,
      実績累計: t.cumActualRevenue,
      着地見込み: t.cumProjectedRevenue,
      予算ペース: t.cumBudgetRevenue,
    }))
  }, [data])

  const ratioPct =
    data?.budget.revenueRatio != null ? Math.round(data.budget.revenueRatio * 1000) / 10 : null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Flag className="w-4 h-4" />
              当月着地予測（着地遷移）
            </CardTitle>
            <CardDescription className="mt-1">
              実績済みの日は実績、未実績の日はAI予測で埋めて月末着地を推計します
            </CardDescription>
          </div>
          <div className="flex items-center gap-1.5">
            <Label htmlFor="landing-month" className="text-xs whitespace-nowrap text-muted-foreground">
              対象月
            </Label>
            <input
              id="landing-month"
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
        ) : !data || (data.actualDays === 0 && data.forecastDays === 0) ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            この月の実績・予測データがありません。
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">着地見込み売上</div>
                <div className="text-lg font-semibold">¥{data.landing.projectedRevenue.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">
                  実績{data.actualDays}日＋予測{data.forecastDays}日
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">予算比</div>
                <div
                  className={`text-lg font-semibold ${
                    ratioPct == null ? "" : ratioPct >= 100 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                  }`}
                >
                  {ratioPct != null ? `${ratioPct.toFixed(1)}%` : "-"}
                </div>
                {data.budget.budgetRevenue != null && (
                  <div className="text-xs text-muted-foreground">
                    予算 ¥{data.budget.budgetRevenue.toLocaleString()}
                  </div>
                )}
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">着地稼働率</div>
                <div className="text-lg font-semibold">
                  {data.landing.projectedOccupancy != null
                    ? `${(data.landing.projectedOccupancy * 100).toFixed(1)}%`
                    : "-"}
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">着地ADR</div>
                <div className="text-lg font-semibold">
                  {data.landing.projectedAdr != null ? `¥${data.landing.projectedAdr.toLocaleString()}` : "-"}
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">当日までの実績売上</div>
                <div className="text-lg font-semibold">¥{data.actualToDate.revenue.toLocaleString()}</div>
              </div>
            </div>

            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tickFormatter={(v: number) => yenM(v)} tick={{ fontSize: 10 }} width={56} />
                  <Tooltip formatter={(v) => `¥${Number(v).toLocaleString()}`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area
                    type="monotone"
                    dataKey="実績累計"
                    stroke="var(--chart-1, #2563eb)"
                    fill="var(--chart-1, #2563eb)"
                    fillOpacity={0.15}
                    strokeWidth={2}
                    connectNulls={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="着地見込み"
                    stroke="var(--chart-2, #16a34a)"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="予算ペース"
                    stroke="var(--muted-foreground, #6b7280)"
                    strokeWidth={1.5}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
