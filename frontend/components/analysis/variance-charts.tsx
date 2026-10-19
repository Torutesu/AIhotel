"use client"

// 日別パフォーマンスのグラフ（2026-10 の画面修正 追加1019）。どちらも横軸は「180日前 → 結果」。
//   月のグラフ: 月全体の予約室数の合計の 予算差異・AI差異・前年比 の推移（GET /analysis/month-pace）
//   日のグラフ: 選んだ日（日付の選択か表の行）の 予算差異・AI差異・前年比 の推移（GET /daily/booking-curve）
// どちらもその時点の予約室数で比べる（予約の単価・売上の推移は PMS 連携後）。

import { useMemo } from "react"
import { LineChart as LineChartIcon } from "lucide-react"
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { useApiQuery } from "@/hooks/use-api-query"
import { DAY_NAMES, toDateStr } from "@/lib/date"
import { formatPercent, formatPt, formatSignedPt } from "@/lib/format"
import type { ChartTooltipProps } from "@/lib/chart-tooltip"
import { api, type BookingCurve, type MonthPace } from "@/lib/api"
import { buildDayPaceRows, buildMonthPaceRows, type DayPaceRow } from "./performance-variance"

type Group = "budget" | "ai" | "yoy"
const GROUP_TITLES: Record<Group, string> = { budget: "予算差異推移", ai: "AI差異推移", yoy: "前年比推移" }
const GROUP_COLORS: Record<Group, string> = { budget: "var(--positive)", ai: "var(--chart-2)", yoy: "var(--chart-4)" }

function formatValue(group: Group, value: number | null): string {
  if (value == null) return "-"
  return group === "yoy" ? formatPt(value * 100) : formatSignedPt(value)
}

/** 180日前 → 結果 の推移のグラフ（月・日で共通） */
function PaceChart({ rows, group, resultLabel }: { rows: DayPaceRow[]; group: Group; resultLabel: string }) {
  const hasData = rows.some((r) => r[group] != null)
  const PaceTooltip = ({ active, payload }: ChartTooltipProps) => {
    if (!active || !payload?.length) return null
    const row = payload[0].payload as DayPaceRow
    return (
      <div className="rounded-lg border bg-background p-2 text-xs shadow-lg">
        <p className="font-medium">{row.daysBefore === 0 ? resultLabel : `${row.daysBefore}日前`}</p>
        <p>
          {GROUP_TITLES[group].replace("推移", "")}: {formatValue(group, row[group])}
        </p>
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
          <ComposedChart data={rows} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
            <XAxis
              dataKey="daysBefore"
              type="number"
              domain={[0, 180]}
              reversed
              ticks={[180, 120, 90, 60, 30, 14, 0]}
              tickFormatter={(v) => (v === 0 ? "結果" : `${v}日前`)}
              tick={{ fontSize: 9 }}
              stroke="currentColor"
              opacity={0.5}
            />
            <YAxis
              tick={{ fontSize: 9 }}
              tickFormatter={(v) => `${(v * 100).toFixed(0)}${group === "yoy" ? "%" : "pt"}`}
              stroke="currentColor"
              opacity={0.5}
              width={44}
            />
            <ReferenceLine y={0} stroke="currentColor" opacity={0.4} />
            <Tooltip content={<PaceTooltip />} />
            <Line type="linear" dataKey={group} stroke={GROUP_COLORS[group]} strokeWidth={2} dot={{ r: 1.5 }} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

function PaceChartRow({ rows, resultLabel }: { rows: DayPaceRow[]; resultLabel: string }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {(["budget", "ai", "yoy"] as const).map((g) => (
        <PaceChart key={g} rows={rows} group={g} resultLabel={resultLabel} />
      ))}
    </div>
  )
}

export function VarianceMonthCharts({ year, month }: { year: number; month: number }) {
  const { hotelId } = useAuth()
  const { data: pace, loading, error, reload } = useApiQuery<MonthPace>(
    hotelId ? () => api.monthPace(hotelId, year, month) : null,
    [hotelId, year, month],
    "月のグラフの取得に失敗しました",
  )
  const rows = useMemo(() => (pace ? buildMonthPaceRows(pace) : []), [pace])
  const latest = pace?.points.at(-1) ?? null
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium">月のグラフ（{month}月全体の 180日前 → 結果）</h4>
        {pace && latest && (
          <p className="text-[11px] text-muted-foreground">
            {latest.daysBefore === 0 ? "結果" : `${latest.daysBefore}日前時点`} {formatPercent(latest.occupancy)}／予算 {formatPercent(pace.budgetOccupancy)}／AI予測{" "}
            {formatPercent(pace.aiOccupancy)}
          </p>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-[200px] w-full" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          この月の宿泊日に予約の記録（OTB の取り込み）がそろっていないため、月のグラフを出せません。
        </p>
      ) : (
        <>
          <PaceChartRow rows={rows} resultLabel="結果（月の販売室数）" />
          <p className="text-[11px] text-muted-foreground">
            月の各宿泊日の「N日前の予約室数」を足し上げて比べます（予算差異・AI差異 = 月の予約の稼働率 − 予算・AI の予測の稼働率、前年比 = 前年同曜日の同じ時点との比）。
            今月のように、まだその時点に達していない宿泊日がある期間は表示しません。
          </p>
        </>
      )}
    </div>
  )
}

interface VarianceDayChartsProps {
  /** 選んだ日（"yyyy-MM-dd"） */
  date: string | null
  year: number
  month: number
  onDateChange: (date: string) => void
  /** 予約動向のブッキングカーブ（同じ日）を開く */
  onOpenBookingCurve?: () => void
}

export function VarianceDayCharts({ date, year, month, onDateChange, onOpenBookingCurve }: VarianceDayChartsProps) {
  const { hotelId } = useAuth()
  const { data: curve, loading, error, reload } = useApiQuery<BookingCurve>(
    hotelId && date ? () => api.bookingCurve(hotelId, date) : null,
    [hotelId, date],
    "日のグラフの取得に失敗しました",
  )
  const rows = useMemo(() => (curve ? buildDayPaceRows(curve) : []), [curve])
  const daysInMonth = new Date(year, month, 0).getDate()
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">日のグラフ（選んだ日の 180日前 → 結果）</h4>
        <div className="flex flex-wrap items-center gap-1.5">
          {date && onOpenBookingCurve && (
            <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={onOpenBookingCurve}>
              <LineChartIcon className="h-3.5 w-3.5" aria-hidden />
              この日のブッキングカーブ
            </Button>
          )}
          <Label htmlFor="day-graph-date" className="whitespace-nowrap text-xs">
            日付を選択
          </Label>
          <Select value={date ?? ""} onValueChange={onDateChange}>
            <SelectTrigger id="day-graph-date" className="h-8 w-36 text-xs">
              <SelectValue placeholder="日付を選択" />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: daysInMonth }, (_, i) => {
                const value = toDateStr(new Date(year, month - 1, i + 1))
                return (
                  <SelectItem key={value} value={value}>
                    {month}/{i + 1}（{DAY_NAMES[new Date(year, month - 1, i + 1).getDay()]}）
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </div>
      </div>
      {!date ? (
        <p className="text-xs text-muted-foreground">日付を選ぶか、表の行をクリックしてください。</p>
      ) : loading ? (
        <Skeleton className="h-[200px] w-full" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <>
          <PaceChartRow rows={rows} resultLabel="結果（当日）" />
          <p className="text-[11px] text-muted-foreground">
            その時点の予約室数で比べます（予算差異・AI差異 = 予約の稼働率 − 予算・AI の予測稼働率、前年比 = 前年同曜日の同じ時点の予約室数との比）。
            結果の出た日は「結果」が販売室数です。予約の単価・売上の推移は PMS 連携後に表示します。
          </p>
        </>
      )}
    </div>
  )
}
