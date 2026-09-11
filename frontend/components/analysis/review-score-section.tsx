"use client"

// 口コミ評価点（X-6 / N-7 / F-ANA-04）
//
// GET /analysis/reviews の実データ（サンプル表示ではない）。
// 取得元（OTA・レビューサイト）ごとの最新評価点と、取得月ごとの推移を表示する。
// 行が1件も無い場合は値を作らず空状態を出す。

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { api, ApiClientError, type ReviewScore } from "@/lib/api"
import { toNumber, type ChartTooltipEntry, type ChartTooltipProps } from "@/lib/chart-tooltip"

/** 取得元の表示名。未知のキーはそのまま出す */
const SOURCE_LABELS: Record<string, string> = {
  rakuten: "楽天トラベル",
  jalan: "じゃらん",
  ikkyu: "一休.com",
  expedia: "Expedia",
  agoda: "Agoda",
  google: "Google",
  tripadvisor: "トリップアドバイザー",
}

const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
]

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source
}

/** 取得日時を "YYYY-MM" のキーにまとめる（取得は月次を想定） */
function monthKey(capturedAt: string): string {
  const date = new Date(capturedAt)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

function monthDisplay(key: string): string {
  const [year, month] = key.split("-")
  return `${year}/${month}`
}

interface LatestRow {
  source: string
  score: number
  reviewCount: number | null
  capturedAt: string
  /** 1つ前の取得値との差（前回が無ければ null） */
  diff: number | null
}

export function ReviewScoreSection() {
  const { hotelId } = useAuth()
  const [reviews, setReviews] = useState<ReviewScore[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!hotelId) return
    setLoading(true)
    setError(null)
    try {
      setReviews(await api.reviewScores(hotelId))
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "口コミ評価点の取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId])

  useEffect(() => {
    load()
  }, [load])

  /** 取得元ごとに取得日の昇順へ並べ替える */
  const bySource = useMemo(() => {
    const map = new Map<string, ReviewScore[]>()
    for (const row of reviews) {
      const list = map.get(row.source) ?? []
      list.push(row)
      map.set(row.source, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime())
    }
    return map
  }, [reviews])

  const sources = useMemo(() => [...bySource.keys()].sort(), [bySource])

  /** 取得元ごとの最新値と前回差 */
  const latestRows = useMemo<LatestRow[]>(() => {
    return sources.map((source) => {
      const list = bySource.get(source) ?? []
      const latest = list[list.length - 1]
      const previous = list.length >= 2 ? list[list.length - 2] : null
      return {
        source,
        score: latest.score,
        reviewCount: latest.reviewCount,
        capturedAt: latest.capturedAt,
        diff: previous ? Math.round((latest.score - previous.score) * 100) / 100 : null,
      }
    })
  }, [bySource, sources])

  /** 全取得元の最新平均（単純平均） */
  const overallAverage = useMemo(() => {
    if (latestRows.length === 0) return null
    const sum = latestRows.reduce((acc, row) => acc + row.score, 0)
    return Math.round((sum / latestRows.length) * 100) / 100
  }, [latestRows])

  /** 取得月 × 取得元の推移データ */
  const chartData = useMemo(() => {
    const months = [...new Set(reviews.map((r) => monthKey(r.capturedAt)))].sort()
    return months.map((key) => {
      const point: Record<string, string | number | null> = { month: monthDisplay(key) }
      for (const source of sources) {
        const hit = (bySource.get(source) ?? []).find((r) => monthKey(r.capturedAt) === key)
        point[source] = hit ? hit.score : null
      }
      return point
    })
  }, [reviews, sources, bySource])

  const ReviewTooltip = ({ active, payload, label }: ChartTooltipProps) => {
    if (!active || !payload || payload.length === 0) return null
    return (
      <div className="rounded-lg border border-border bg-background p-3 shadow-lg">
        <p className="mb-2 text-sm font-medium">{label}</p>
        <div className="space-y-1">
          {payload.map((entry: ChartTooltipEntry, index: number) => {
            if (entry.value == null) return null
            return (
              <p key={index} className="flex items-center gap-2 text-xs">
                <span className="h-0.5 w-3" style={{ backgroundColor: entry.color }} />
                <span>
                  {entry.name}: {toNumber(entry.value).toFixed(2)}
                </span>
              </p>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base font-medium">口コミ評価点</CardTitle>
          <p className="text-xs text-muted-foreground">
            OTA・レビューサイト別の評価点（5点満点）と取得月ごとの推移
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {loading ? (
          <Skeleton className="h-72 w-full" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : latestRows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            口コミ評価点のデータがまだありません。
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-baseline gap-2">
                  <h3 className="text-sm font-medium text-muted-foreground">最新の評価点</h3>
                  {overallAverage != null && (
                    <span className="text-xs text-muted-foreground">
                      全体平均 {overallAverage.toFixed(2)}
                    </span>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] border-collapse text-xs">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="border-r px-2 py-1.5 text-left font-medium">取得元</th>
                        <th className="border-r px-2 py-1.5 text-right font-medium">評価点</th>
                        <th className="border-r px-2 py-1.5 text-right font-medium">前回差</th>
                        <th className="border-r px-2 py-1.5 text-right font-medium">口コミ件数</th>
                        <th className="px-2 py-1.5 text-right font-medium">取得日</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latestRows.map((row) => (
                        <tr key={row.source} className="border-b hover:bg-muted/20">
                          <td className="border-r px-2 py-1.5 font-medium">
                            {sourceLabel(row.source)}
                          </td>
                          <td className="border-r px-2 py-1.5 text-right font-semibold">
                            {row.score.toFixed(2)}
                          </td>
                          <td
                            className={`border-r px-2 py-1.5 text-right ${
                              row.diff == null
                                ? "text-muted-foreground"
                                : row.diff >= 0
                                  ? "text-positive"
                                  : "text-negative"
                            }`}
                          >
                            {row.diff == null
                              ? "-"
                              : `${row.diff >= 0 ? "+" : ""}${row.diff.toFixed(2)}`}
                          </td>
                          <td className="border-r px-2 py-1.5 text-right text-muted-foreground">
                            {row.reviewCount != null ? row.reviewCount.toLocaleString() : "-"}
                          </td>
                          <td className="px-2 py-1.5 text-right text-muted-foreground">
                            {monthDisplay(monthKey(row.capturedAt))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">評価点の推移</h3>
                {chartData.length < 2 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    推移を描くには2回以上の取得が必要です。
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                      <XAxis
                        dataKey="month"
                        tick={{ fontSize: 11 }}
                        stroke="currentColor"
                        opacity={0.5}
                      />
                      <YAxis
                        domain={[3.5, 5]}
                        tick={{ fontSize: 11 }}
                        stroke="currentColor"
                        opacity={0.5}
                        tickFormatter={(value) => toNumber(value).toFixed(1)}
                      />
                      <Tooltip content={<ReviewTooltip />} />
                      <Legend wrapperStyle={{ fontSize: "12px" }} />
                      {sources.map((source, index) => (
                        <Line
                          key={source}
                          type="monotone"
                          dataKey={source}
                          name={sourceLabel(source)}
                          stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                          strokeWidth={2}
                          dot={{ r: 3 }}
                          connectNulls={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
