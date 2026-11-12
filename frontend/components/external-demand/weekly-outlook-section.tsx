"use client"

// 週別の見通し（今週から8週間 — D-13 で実データに）。保存済みの需要予測の推奨理由から、
// 「ベースの需要＋イベントの効果＋市場の動きの効果＝予測稼働率」を週ごとの平均で積み上げる。
// 需要予測は天気を直接の補正に使っていないので、気候の効果は出さない。

import { Calendar } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Legend, XAxis, YAxis } from "recharts"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { ErrorState } from "@/components/error-state"
import type { ExternalFactors } from "@/lib/api"

const chartConfig = {
  base: { label: "ベースの需要", color: "var(--chart-1)" },
  event: { label: "イベントの効果", color: "var(--chart-2)" },
  market: { label: "市場の動きの効果", color: "var(--chart-3)" },
}

interface WeeklyOutlookSectionProps {
  data: ExternalFactors | null
  loading: boolean
  error: string | null
  onRetry: () => void
}

export function WeeklyOutlookSection({ data, loading, error, onRetry }: WeeklyOutlookSectionProps) {
  const rows = (data?.weekly ?? []).map((w) => ({
    week: `${Number(w.weekStart.slice(5, 7))}/${Number(w.weekStart.slice(8, 10))}〜`,
    label: w.label,
    // 下がる効果は積み上げに入れず、ベースに含めて見せる（棒が負の方向に割れないように）
    base: w.base == null ? null : Math.round((w.base + Math.min(0, w.event ?? 0) + Math.min(0, w.market ?? 0)) * 10) / 10,
    event: w.event == null ? null : Math.max(0, w.event),
    market: w.market == null ? null : Math.max(0, w.market),
    total: w.total,
  }))
  const hasData = rows.some((r) => r.total != null)
  return (
    <Card data-testid="weekly-outlook">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" aria-hidden />
          週別の見通し（今週から8週間）
        </CardTitle>
        <CardDescription>
          需要予測の予測稼働率（週平均）を、ベースの需要・イベントの効果・市場の動きの効果に分けて積み上げています。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">読み込み中…</p>
        ) : error ? (
          <ErrorState message={error} onRetry={onRetry} />
        ) : !hasData ? (
          <p className="text-sm text-muted-foreground">まだ需要予測がありません。日次バッチが予測を作ると表示されます。</p>
        ) : (
          <>
            <ChartContainer config={chartConfig} className="h-[280px] w-full">
              <BarChart data={rows} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Legend />
                <Bar dataKey="base" name="ベースの需要" stackId="a" fill="var(--color-base)" />
                <Bar dataKey="event" name="イベントの効果" stackId="a" fill="var(--color-event)" />
                <Bar dataKey="market" name="市場の動きの効果" stackId="a" fill="var(--color-market)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ChartContainer>
            <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
              {rows.map((r) => (
                <li key={r.week} className="flex justify-between gap-2">
                  <span>{r.week}</span>
                  <span className="tabular-nums text-foreground">{r.total == null ? "—" : `${r.total}%`}</span>
                  {r.label && <span className="sr-only">{r.label}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}
