"use client"

// 日別パフォーマンスの表（2026-10 の画面修正）。実績・予算差異・AI想定差異・前年比を日ごとに並べる。
// 料金カレンダーにあった「結果」と「想定差異」をここへ移した。実データ: GET /analysis/daily-performance。

import { Badge } from "@/components/ui/badge"
import { useWeekend } from "@/hooks/use-weekend"
import { DAY_NAMES } from "@/lib/date"
import { formatPercent, formatPt, formatRooms, formatSignedPt, formatSignedYen, formatYen } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { DailyPerformanceDay } from "@/lib/api"
import { buildVarianceRows, summarizeVariance, type VarianceMetric, type VarianceSet } from "./performance-variance"

const METRICS: VarianceMetric[] = ["occupancy", "adr", "revPar", "revenue"]
const METRIC_HEADERS: Record<VarianceMetric, string> = { occupancy: "稼働率", adr: "ADR", revPar: "REV-Per", revenue: "室料売上" }

/** 差異の表示（稼働率は pt、それ以外は円） */
export function formatDifference(metric: VarianceMetric, value: number | null): string {
  return metric === "occupancy" ? formatSignedPt(value) : formatSignedYen(value)
}

/** 前年比の表示（稼働率は pt 差、それ以外は伸び率） */
export function formatYoy(metric: VarianceMetric, value: number | null): string {
  if (value == null) return "-"
  return metric === "occupancy" ? formatSignedPt(value) : formatPt(value * 100)
}

function signClass(value: number | null): string {
  if (value == null || value === 0) return "text-muted-foreground"
  return value > 0 ? "text-positive" : "text-negative"
}

function VarianceCells({ set, format, first }: { set: VarianceSet; format: (m: VarianceMetric, v: number | null) => string; first?: boolean }) {
  return (
    <>
      {METRICS.map((metric, i) => (
        <td key={metric} className={cn("px-2 py-1.5 text-right tabular-nums", signClass(set[metric]), i === 0 && first !== false && "border-l")}>
          {set[metric] == null ? "-" : format(metric, set[metric])}
        </td>
      ))}
    </>
  )
}

interface DailyVarianceTableProps {
  days: DailyPerformanceDay[]
  totalRooms: number
  month: number
  selectedDate: string | null
  onSelectDate: (date: string) => void
  onNavigateToPricing?: (date: Date) => void
}

export function DailyVarianceTable({ days, totalRooms, month, selectedDate, onSelectDate, onNavigateToPricing }: DailyVarianceTableProps) {
  const { isWeekendDow } = useWeekend()
  const rows = buildVarianceRows(days)
  const summary = summarizeVariance(days, totalRooms)

  return (
    <div className="max-h-[600px] overflow-auto">
      <table className="table-sticky-head w-full min-w-[1100px] whitespace-nowrap text-xs">
        <thead>
          <tr className="border-b bg-background">
            <th colSpan={2} className="px-2 py-1.5" />
            <th colSpan={5} className="border-l px-2 py-1.5 text-center font-medium">実績</th>
            <th colSpan={4} className="border-l px-2 py-1.5 text-center font-medium">予算差異</th>
            <th colSpan={4} className="border-l px-2 py-1.5 text-center font-medium">AI想定差異</th>
            <th colSpan={4} className="border-l px-2 py-1.5 text-center font-medium">前年比</th>
          </tr>
          <tr className="border-b bg-background">
            <th className="px-2 py-1.5 text-left font-medium">日付</th>
            <th className="px-2 py-1.5 text-left font-medium">曜日</th>
            <th className="border-l px-2 py-1.5 text-right font-medium">販売室数</th>
            {METRICS.map((m) => (
              <th key={`a-${m}`} className="px-2 py-1.5 text-right font-medium">{METRIC_HEADERS[m]}</th>
            ))}
            {(["b", "ai", "y"] as const).map((g) =>
              METRICS.map((m, i) => (
                <th key={`${g}-${m}`} className={cn("px-2 py-1.5 text-right font-medium", i === 0 && "border-l")}>
                  {METRIC_HEADERS[m]}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isSelected = selectedDate === row.date
            return (
              <tr
                key={row.date}
                role="button"
                tabIndex={0}
                aria-label={`${month}/${row.day}を選んで日のグラフとブッキングカーブを表示`}
                aria-pressed={isSelected}
                onClick={() => onSelectDate(row.date)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onSelectDate(row.date)
                  }
                }}
                className={cn(
                  "cursor-pointer border-b hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  !row.hasActual && "text-muted-foreground",
                  isSelected && "bg-primary/10",
                )}
              >
                <td className="px-2 py-1.5 font-medium">
                  {/* 日付リンクはダイナミックプライシングの同じ日へ遷移する（行クリックとは別動作） */}
                  <button
                    type="button"
                    className="text-primary underline-offset-2 hover:underline"
                    title={`${month}/${row.day} のダイナミックプライシングを開く`}
                    onClick={(e) => {
                      e.stopPropagation()
                      const [y, m, d] = row.date.split("-").map(Number)
                      onNavigateToPricing?.(new Date(y, m - 1, d))
                    }}
                  >
                    {month}/{row.day}
                  </button>
                </td>
                <td className="px-2 py-1.5">
                  <Badge variant={isWeekendDow(row.dow) ? "default" : "outline"} className="text-xs">
                    {DAY_NAMES[row.dow]}
                  </Badge>
                </td>
                <td className="border-l px-2 py-1.5 text-right tabular-nums">{formatRooms(row.actual?.soldRooms)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatPercent(row.actual?.occupancy)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatYen(row.actual?.adr)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{formatYen(row.actual?.revPar)}</td>
                <td className="px-2 py-1.5 text-right font-medium tabular-nums">{formatYen(row.actual?.revenue)}</td>
                <VarianceCells set={row.budget} format={formatDifference} />
                <VarianceCells set={row.ai} format={formatDifference} />
                <VarianceCells set={row.yoy} format={formatYoy} />
              </tr>
            )
          })}
        </tbody>
        {summary.actual && (
          <tfoot className="border-t-2">
            <tr className="bg-muted/30 font-semibold">
              <td className="px-2 py-2" colSpan={2}>
                月計（実績{summary.days}日分）
              </td>
              <td className="border-l px-2 py-2 text-right tabular-nums">{formatRooms(summary.actual.soldRooms)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{formatPercent(summary.actual.occupancy)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{formatYen(summary.actual.adr)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{formatYen(summary.actual.revPar)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{formatYen(summary.actual.revenue)}</td>
              <VarianceCells set={summary.budget} format={formatDifference} />
              <VarianceCells set={summary.ai} format={formatDifference} />
              <VarianceCells set={summary.yoy} format={formatYoy} />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
