"use client"

// 1年先アウトルック（プライシングタブ）
// レベニュー担当者は約330日先を見る運用のため、今後365日分のAI推奨価格・
// 予測稼働率を月別に集計して表示する。「1年先をいくらで出すべきか」の起点となる画面。

import { useState, useEffect, useCallback, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { AlertCircle, CalendarRange, Loader2, RefreshCw } from "lucide-react"
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import { useToast } from "@/hooks/use-toast"
import { useAuth } from "@/components/auth-provider"
import { api, ApiClientError, type LongRangeOutlook } from "@/lib/api"

const DEMAND_BADGE: Record<string, string> = {
  A: "bg-red-500/15 text-red-600 dark:text-red-400",
  B: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  C: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  D: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  E: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
}

export function LongRangeOutlookSection() {
  const { hotelId, user } = useAuth()
  const { toast } = useToast()
  const canManage = user?.role === "ADMIN" || user?.role === "MANAGER"

  const [outlook, setOutlook] = useState<LongRangeOutlook | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recomputing, setRecomputing] = useState(false)

  const load = useCallback(async () => {
    if (!hotelId) return
    setLoading(true)
    setError(null)
    try {
      setOutlook(await api.longRangeOutlook(hotelId, 365))
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "1年先アウトルックの取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId])

  useEffect(() => {
    load()
  }, [load])

  const handleRecompute = async () => {
    if (!hotelId) return
    setRecomputing(true)
    try {
      const result = await api.recomputeForecast(hotelId)
      toast({ title: "需要予測を再計算しました", description: `${result.count}件の予測を更新しました` })
      load()
    } catch (err) {
      toast({
        variant: "destructive",
        title: "再計算に失敗しました",
        description: err instanceof ApiClientError ? err.message : undefined,
      })
    } finally {
      setRecomputing(false)
    }
  }

  const chartData = useMemo(() => {
    if (!outlook) return []
    return outlook.months.map((m) => ({
      month: `${String(m.year).slice(2)}/${m.month}`,
      平均推奨価格: m.avgRecommendedPrice,
      予測稼働率: m.avgPredictedOccupancy != null ? Math.round(m.avgPredictedOccupancy * 1000) / 10 : null,
    }))
  }, [outlook])

  // 365日中どこまで予測が存在するか（不足していれば再計算を促す）
  const coverageShort = outlook != null && outlook.coverageDays < outlook.days - 40

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <CalendarRange className="w-4 h-4" />
              1年先アウトルック（月別推奨価格）
            </CardTitle>
            <CardDescription className="mt-1">
              今後365日分のAI推奨価格・予測稼働率を月別に集計します。詳細な日別価格は上部のカレンダーで確認してください
            </CardDescription>
          </div>
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2 bg-transparent"
              onClick={handleRecompute}
              disabled={recomputing || !hotelId}
            >
              {recomputing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              365日分を再計算
            </Button>
          )}
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
        ) : !outlook || outlook.months.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              先々の予測データがまだありません。
              {canManage ? "「365日分を再計算」を実行してください。" : "MANAGER以上のユーザーが再計算を実行できます。"}
            </p>
          </div>
        ) : (
          <>
            {coverageShort && (
              <p className="text-xs rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2">
                予測が存在するのは今後{outlook.coverageDays}日分です。1年先まで見るには「365日分を再計算」を実行してください。
              </p>
            )}

            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis
                    yAxisId="price"
                    tickFormatter={(v: number) => `¥${(v / 1000).toFixed(0)}k`}
                    tick={{ fontSize: 10 }}
                    width={48}
                  />
                  <YAxis
                    yAxisId="occ"
                    orientation="right"
                    domain={[0, 100]}
                    tickFormatter={(v: number) => `${v}%`}
                    tick={{ fontSize: 10 }}
                    width={40}
                  />
                  <Tooltip
                    formatter={(v, name) =>
                      name === "予測稼働率" ? `${Number(v)}%` : `¥${Number(v).toLocaleString()}`
                    }
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="price" dataKey="平均推奨価格" fill="var(--chart-1, #2563eb)" fillOpacity={0.75} />
                  <Line
                    yAxisId="occ"
                    type="monotone"
                    dataKey="予測稼働率"
                    stroke="var(--chart-2, #16a34a)"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium">月</th>
                    <th className="text-right py-2 px-3 font-medium">平均推奨価格</th>
                    <th className="text-right py-2 px-3 font-medium">価格レンジ</th>
                    <th className="text-right py-2 px-3 font-medium">予測稼働率</th>
                    <th className="text-center py-2 px-3 font-medium">需要レベル（最頻）</th>
                    <th className="text-right py-2 px-3 font-medium">予測日数</th>
                  </tr>
                </thead>
                <tbody>
                  {outlook.months.map((m) => (
                    <tr key={`${m.year}-${m.month}`} className="border-b hover:bg-muted/50">
                      <td className="py-2 px-3 whitespace-nowrap">
                        {m.year}年{m.month}月
                      </td>
                      <td className="text-right py-2 px-3">
                        {m.avgRecommendedPrice != null ? `¥${m.avgRecommendedPrice.toLocaleString()}` : "-"}
                      </td>
                      <td className="text-right py-2 px-3 whitespace-nowrap">
                        {m.minRecommendedPrice != null && m.maxRecommendedPrice != null
                          ? `¥${m.minRecommendedPrice.toLocaleString()} 〜 ¥${m.maxRecommendedPrice.toLocaleString()}`
                          : "-"}
                      </td>
                      <td className="text-right py-2 px-3">
                        {m.avgPredictedOccupancy != null
                          ? `${(m.avgPredictedOccupancy * 100).toFixed(1)}%`
                          : "-"}
                      </td>
                      <td className="text-center py-2 px-3">
                        {m.dominantDemandLevel ? (
                          <Badge className={`${DEMAND_BADGE[m.dominantDemandLevel]} text-[10px] font-bold`}>
                            {m.dominantDemandLevel}
                          </Badge>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="text-right py-2 px-3">{m.forecastDays}日</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
