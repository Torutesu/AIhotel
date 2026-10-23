"use client"

// オンハンド状況（2026-10 のデモ画面の修正 DP04。以前の「価格推移グラフ」を置き換え）。
// 見出しの「個人団体別」は 2026-10-23 の画面修正 b04 で外した（個人・団体の扱いはヒアリングのうえ検討）。
// 日ごとに オンハンド室数（棒）・予算室数（面）・オンハンドADR（線）・予算ADR（線）を並べる。左軸 = 室数、右軸 = 円。
// 室数は個人・団体の合計。先の日の予約の単価は PMS 連携（Phase 4）で入る。今は結果の出た日の実績ADR。

import { useMemo } from "react"
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { useWeekend } from "@/hooks/use-weekend"
import { DAY_NAMES } from "@/lib/date"
import { formatRooms, formatYen } from "@/lib/format"
import type { ChartTooltipEntry, ChartTooltipProps } from "@/lib/chart-tooltip"
import type { PricingCalendarDay } from "@/lib/api"

export interface OnHandChartRow {
  day: number
  dow: number
  label: string
  onHandRooms: number | null
  budgetRooms: number | null
  onHandAdr: number | null
  budgetAdr: number | null
}

/** グラフの行に直す（純関数） */
export function toOnHandRows(days: PricingCalendarDay[]): OnHandChartRow[] {
  return days.map((d) => {
    const [y, m, dd] = d.date.split("-").map(Number)
    const dow = new Date(y, m - 1, dd).getDay()
    return {
      day: dd,
      dow,
      label: `${dd}（${DAY_NAMES[dow]}）`,
      onHandRooms: d.onHandRooms,
      budgetRooms: d.budgetRooms,
      onHandAdr: d.onHandAdr,
      budgetAdr: d.budgetAdr,
    }
  })
}

function OnHandTooltip({ active, payload }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0].payload as OnHandChartRow | undefined
  return (
    <div className="rounded-lg border border-border bg-background p-3 shadow-lg">
      <p className="mb-2 text-sm font-medium">{row?.label}</p>
      <div className="space-y-1">
        {payload.map((entry: ChartTooltipEntry, index: number) => {
          const name = String(entry.name ?? "")
          const value = entry.value == null ? null : Number(entry.value)
          return (
            <p key={index} className="flex items-center gap-2 text-xs">
              <span className="h-0.5 w-3" style={{ backgroundColor: entry.color }} />
              <span>
                {name}: {name.includes("ADR") ? formatYen(value) : formatRooms(value)}
              </span>
            </p>
          )
        })}
      </div>
    </div>
  )
}

interface OnHandChartProps {
  days: PricingCalendarDay[]
  totalRooms: number | null
}

export function OnHandChart({ days, totalRooms }: OnHandChartProps) {
  const { isWeekendDow } = useWeekend()
  const rows = useMemo(() => toOnHandRows(days), [days])
  const hasFutureAdr = days.some((d) => d.actualAdr == null && d.onHandAdr != null)

  const DayTick = ({ x, y, payload }: { x?: number; y?: number; payload?: { value: number } }) => {
    const row = rows.find((r) => r.day === payload?.value)
    if (!row) return null
    const weekend = isWeekendDow(row.dow)
    return (
      <g transform={`translate(${x ?? 0},${y ?? 0})`}>
        <text dy={12} textAnchor="middle" fontSize={10} className={weekend ? "fill-primary" : "fill-muted-foreground"}>
          {DAY_NAMES[row.dow]}
        </text>
        <text dy={26} textAnchor="middle" fontSize={10} className="fill-muted-foreground">
          {String(row.day).padStart(2, "0")}
        </text>
      </g>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">オンハンド状況</h3>
        <p className="text-[11px] text-muted-foreground">左軸: 室数／右軸: ADR（円）</p>
      </div>
      <p className="text-xs text-muted-foreground">
        オンハンド（OH）は今の予約室数、結果の出た日は販売室数です（個人・団体の合計）。予算は月次予算を前年同曜日の販売室数の比で日に配った値です。
        {!hasFutureAdr && " 全体ADR（OH）は結果の出た日の実績ADRで、先の日の予約の単価は PMS 連携後に表示します。"}
      </p>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={rows} margin={{ top: 10, right: 16, left: 4, bottom: 18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
          <XAxis dataKey="day" interval={0} tick={<DayTick />} height={36} stroke="currentColor" opacity={0.5} />
          <YAxis
            yAxisId="rooms"
            tick={{ fontSize: 11 }}
            stroke="currentColor"
            opacity={0.5}
            domain={[0, totalRooms ? Math.ceil((totalRooms * 1.1) / 10) * 10 : "auto"]}
            tickFormatter={(v) => `${v}`}
            label={{ value: "室", position: "insideTopLeft", offset: 0, fontSize: 10 }}
          />
          <YAxis
            yAxisId="yen"
            orientation="right"
            tick={{ fontSize: 11 }}
            stroke="currentColor"
            opacity={0.5}
            domain={[0, "auto"]}
            tickFormatter={(v) => `¥${Number(v).toLocaleString()}`}
            width={72}
          />
          <Tooltip content={<OnHandTooltip />} />
          <Legend wrapperStyle={{ fontSize: "11px" }} />
          <Area
            yAxisId="rooms"
            type="linear"
            dataKey="budgetRooms"
            name="ALL室数 予算"
            fill="var(--chart-3)"
            fillOpacity={0.18}
            stroke="var(--chart-3)"
            strokeWidth={1}
            connectNulls
          />
          <Bar yAxisId="rooms" dataKey="onHandRooms" name="ALL室数 OH" fill="var(--chart-1)" barSize={14} radius={[2, 2, 0, 0]} />
          <Line
            yAxisId="yen"
            type="linear"
            dataKey="onHandAdr"
            name="全体ADR OH"
            stroke="var(--negative)"
            strokeWidth={2}
            dot={{ r: 2.5 }}
            connectNulls={false}
          />
          <Line
            yAxisId="yen"
            type="linear"
            dataKey="budgetAdr"
            name="全体ADR 予算"
            stroke="var(--warning)"
            strokeWidth={1.5}
            dot={{ r: 2.5 }}
            strokeDasharray="4 2"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
