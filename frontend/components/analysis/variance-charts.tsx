"use client"

// 日別パフォーマンスのグラフ（2026-10 の画面修正）。
//   月のグラフ: 予算差異推移・AI差異推移・前年比推移（対象月の日ごと。指標を選べる）
//   日のグラフ: 選んだ日の 180日前 → 結果 の 予算差異・AI差異・前年比（その時点の予約室数で比べる）

import { useMemo, useState } from "react"
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { useApiQuery } from "@/hooks/use-api-query"
import { formatPt, formatSignedPt, formatSignedYen } from "@/lib/format"
import type { ChartTooltipProps } from "@/lib/chart-tooltip"
import { api, type BookingCurve, type DailyPerformanceDay } from "@/lib/api"
import { formatDifference, formatYoy } from "./daily-variance-table"
import {
  buildDayPaceRows,
  buildVarianceRows,
  VARIANCE_METRICS,
  type DayPaceRow,
  type VarianceMetric,
  type VarianceRow,
} from "./performance-variance"

type Group = "budget" | "ai" | "yoy"
const GROUP_TITLES: Record<Group, string> = { budget: "予算差異推移", ai: "AI差異推移", yoy: "前年比推移" }

function axisFormat(group: Group, metric: VarianceMetric) {
  return (v: number) => {
    if (group === "yoy") return metric === "occupancy" ? `${(v * 100).toFixed(0)}pt` : `${(v * 100).toFixed(0)}%`
    if (metric === "occupancy") return `${(v * 100).toFixed(0)}pt`
    return Math.abs(v) >= 10000 ? `${(v / 10000).toFixed(0)}万` : `${Math.round(v).toLocaleString()}`
  }
}

function MonthChart({ rows, group, metric, month }: { rows: VarianceRow[]; group: Group; metric: VarianceMetric; month: number }) {
  const data = useMemo(() => {
    let cumulative = 0
    return rows.map((r) => {
      const value = r[group][metric]
      if (value != null && metric === "revenue" && group !== "yoy") cumulative += value
      return { day: r.day, value, cumulative: value != null && metric === "revenue" && group !== "yoy" ? cumulative : null }
    })
  }, [rows, group, metric])
  const format = group === "yoy" ? formatYoy : formatDifference
  const hasData = data.some((d) => d.value != null)
  const MonthTooltip = ({ active, payload }: ChartTooltipProps) => {
    if (!active || !payload?.length) return null
    const row = payload[0].payload as { day: number; value: number | null; cumulative: number | null }
    return (
      <div className="rounded-lg border bg-background p-2 text-xs shadow-lg">
        <p className="font-medium">{month}/{row.day}</p>
        <p>{GROUP_TITLES[group].replace("推移", "")}: {format(metric, row.value)}</p>
        {row.cumulative != null && <p className="text-muted-foreground">月初からの累計: {formatSignedYen(row.cumulative)}</p>}
      </div>
    )
  }
  return (
    <div className="rounded-md border p-2">
      <p className="mb-1 text-xs font-medium">{GROUP_TITLES[group]}</p>
      {!hasData ? (
        <p className="py-12 text-center text-[11px] text-muted-foreground">比べられる実績がまだありません</p>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={data} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
            <XAxis dataKey="day" tick={{ fontSize: 9 }} interval={4} stroke="currentColor" opacity={0.5} />
            <YAxis yAxisId="v" tick={{ fontSize: 9 }} tickFormatter={axisFormat(group, metric)} stroke="currentColor" opacity={0.5} width={44} />
            {metric === "revenue" && group !== "yoy" && (
              <YAxis yAxisId="c" orientation="right" tick={{ fontSize: 9 }} tickFormatter={axisFormat(group, metric)} stroke="currentColor" opacity={0.5} width={40} />
            )}
            <ReferenceLine yAxisId="v" y={0} stroke="currentColor" opacity={0.4} />
            <Tooltip content={<MonthTooltip />} />
            <Bar yAxisId="v" dataKey="value" name={GROUP_TITLES[group]} barSize={6}>
              {data.map((d) => (
                <Cell key={d.day} fill={d.value != null && d.value < 0 ? "var(--negative)" : "var(--positive)"} />
              ))}
            </Bar>
            {metric === "revenue" && group !== "yoy" && (
              <Line yAxisId="c" type="monotone" dataKey="cumulative" name="累計" stroke="var(--chart-4)" strokeWidth={1.5} dot={false} connectNulls />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

export function VarianceMonthCharts({ days, month }: { days: DailyPerformanceDay[]; month: number }) {
  const [metric, setMetric] = useState<VarianceMetric>("revenue")
  const rows = useMemo(() => buildVarianceRows(days), [days])
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">月のグラフ</h4>
        <div className="flex gap-1" role="group" aria-label="グラフの指標">
          {VARIANCE_METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              aria-pressed={metric === m.key}
              onClick={() => setMetric(m.key)}
              className={`rounded-md border px-2 py-0.5 text-xs ${metric === m.key ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {(["budget", "ai", "yoy"] as const).map((g) => (
          <MonthChart key={g} rows={rows} group={g} metric={metric} month={month} />
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        予算差異・AI差異 = 実績 − 予算（AI の予測）。前年比は前年同曜日と比べた伸び（稼働率は pt 差）。室料売上は月初からの累計も線で表示します。
      </p>
    </div>
  )
}

function DayChart({ rows, group }: { rows: DayPaceRow[]; group: Group }) {
  const hasData = rows.some((r) => r[group] != null)
  const DayTooltip = ({ active, payload }: ChartTooltipProps) => {
    if (!active || !payload?.length) return null
    const row = payload[0].payload as DayPaceRow
    const value = row[group]
    return (
      <div className="rounded-lg border bg-background p-2 text-xs shadow-lg">
        <p className="font-medium">{row.daysBefore === 0 ? "結果（当日）" : `${row.daysBefore}日前`}</p>
        <p>{GROUP_TITLES[group].replace("推移", "")}: {group === "yoy" ? (value == null ? "-" : formatPt(value * 100)) : formatSignedPt(value)}</p>
      </div>
    )
  }
  return (
    <div className="rounded-md border p-2">
      <p className="mb-1 text-xs font-medium">{GROUP_TITLES[group]}</p>
      {!hasData ? (
        <p className="py-12 text-center text-[11px] text-muted-foreground">比べられる記録がありません</p>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={rows} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
            <XAxis
              dataKey="daysBefore"
              type="number"
              domain={[0, 180]}
              reversed
              ticks={[180, 120, 90, 60, 30, 14, 0]}
              tickFormatter={(v) => (v === 0 ? "結果" : `${v}`)}
              tick={{ fontSize: 9 }}
              stroke="currentColor"
              opacity={0.5}
            />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={(v) => `${(v * 100).toFixed(0)}${group === "yoy" ? "%" : "pt"}`} stroke="currentColor" opacity={0.5} width={44} />
            <ReferenceLine y={0} stroke="currentColor" opacity={0.4} />
            <Tooltip content={<DayTooltip />} />
            <Line type="linear" dataKey={group} stroke={group === "yoy" ? "var(--chart-4)" : group === "ai" ? "var(--chart-2)" : "var(--positive)"} strokeWidth={2} dot={{ r: 2 }} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

export function VarianceDayCharts({ date }: { date: string | null }) {
  const { hotelId } = useAuth()
  const { data: curve, loading, error, reload } = useApiQuery<BookingCurve>(
    hotelId && date ? () => api.bookingCurve(hotelId, date) : null,
    [hotelId, date],
    "日のグラフの取得に失敗しました",
  )
  const rows = useMemo(() => (curve ? buildDayPaceRows(curve) : []), [curve])
  const [, m, d] = (date ?? "").split("-").map(Number)
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">
        日のグラフ{date ? `（${m}/${d} の 180日前 → 結果）` : ""}
      </h4>
      {!date ? (
        <p className="text-xs text-muted-foreground">表の行をクリックして日付を選んでください。</p>
      ) : loading ? (
        <Skeleton className="h-[200px] w-full" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {(["budget", "ai", "yoy"] as const).map((g) => (
              <DayChart key={g} rows={rows} group={g} />
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            その時点の予約室数で比べます（予算差異・AI差異 = 予約の稼働率 − 予算・AI の予測稼働率、前年比 = 前年同曜日の同じ時点の予約室数との比）。
            結果の出た日は「結果」が販売室数です。予約の単価・売上の推移は PMS 連携後に表示します。
          </p>
        </>
      )}
    </div>
  )
}
