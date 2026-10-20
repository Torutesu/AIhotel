"use client"

// 日別パフォーマンスの表（2026-10 の画面修正）。料金カレンダーにあった「結果」と「想定差異」をここへ移した。
// 実データ: GET /analysis/daily-performance。2つの見方を切り替える（PDF c分析01実績推移2）:
//  - 実数と想定値で見る: 項目ごとに 実数（過去は実績、先の日は今の予約実数）・AI の想定・予算・予算差異を並べる
//  - 差異で見る: 実績（先の日は予約実数）と、予算差異・AI想定差異・前年比
// 稼働率の差は % 表記（PDF bダイナミックプライシング02「％表記の方が良いかも」）。

import { useState, type KeyboardEvent } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useWeekend } from "@/hooks/use-weekend"
import { DAY_NAMES } from "@/lib/date"
import { formatPercent, formatPt, formatRooms, formatSignedPercent, formatSignedYen, formatYen } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { DailyPerformanceDay } from "@/lib/api"
import {
  buildFigureRows,
  buildVarianceRows,
  FIGURE_METRICS,
  summarizeFigures,
  summarizeVariance,
  type FigureCell,
  type FigureMetric,
  type VarianceMetric,
  type VarianceSet,
} from "./performance-variance"

const METRICS: VarianceMetric[] = ["occupancy", "adr", "revPar", "revenue"]
const METRIC_HEADERS: Record<FigureMetric, string> = {
  soldRooms: "販売室数",
  occupancy: "稼働率",
  adr: "ADR",
  revPar: "REV-Per",
  revenue: "室料売上",
}
/** 実数と想定値で見るときの見出し（販売室数・想定販売数、稼働率・想定稼働率…） */
const FIGURE_HEADERS: Record<FigureMetric, { value: string; ai: string }> = {
  soldRooms: { value: "販売室数", ai: "想定販売数" },
  occupancy: { value: "稼働率", ai: "想定稼働率" },
  adr: { value: "ADR", ai: "想定ADR" },
  revPar: { value: "REV-Per", ai: "想定REV-Per" },
  revenue: { value: "室料売上", ai: "想定売上" },
}

export type DailyTableView = "figures" | "variance"

/** 差異の表示（稼働率は %、販売室数は室、それ以外は円） */
export function formatDifference(metric: FigureMetric, value: number | null): string {
  if (metric === "occupancy") return formatSignedPercent(value)
  if (metric === "soldRooms") return value == null ? "-" : `${value >= 0 ? "+" : ""}${Math.round(value).toLocaleString()}室`
  return formatSignedYen(value)
}

/** 前年比の表示（稼働率は差、それ以外は伸び率。どちらも % 表記） */
export function formatYoy(metric: VarianceMetric, value: number | null): string {
  if (value == null) return "-"
  return metric === "occupancy" ? formatSignedPercent(value) : formatPt(value * 100)
}

/** 実数・想定・予算の値の表示 */
function formatValue(metric: FigureMetric, value: number | null): string {
  if (metric === "soldRooms") return formatRooms(value)
  if (metric === "occupancy") return formatPercent(value)
  return formatYen(value)
}

function signClass(value: number | null): string {
  if (value == null || value === 0) return "text-muted-foreground"
  return value > 0 ? "text-positive" : "text-negative"
}

function VarianceCells({ set, format }: { set: VarianceSet; format: (m: VarianceMetric, v: number | null) => string }) {
  return (
    <>
      {METRICS.map((metric, i) => (
        <td key={metric} className={cn("px-2 py-1.5 text-right tabular-nums", signClass(set[metric]), i === 0 && "border-l")}>
          {set[metric] == null ? "-" : format(metric, set[metric])}
        </td>
      ))}
    </>
  )
}

/** 1項目ぶんの 実数・想定・予算・予算差異 */
function FigureCells({ metric, cell, onHand, strong }: { metric: FigureMetric; cell: FigureCell; onHand: boolean; strong?: boolean }) {
  return (
    <>
      <td className={cn("border-l px-2 py-1.5 text-right tabular-nums", strong && "font-medium", onHand && "text-primary")}>
        {formatValue(metric, cell.value)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{formatValue(metric, cell.ai)}</td>
      <td className="bg-muted/40 px-2 py-1.5 text-right tabular-nums">{formatValue(metric, cell.budget)}</td>
      <td className={cn("px-2 py-1.5 text-right tabular-nums", signClass(cell.budgetDiff))}>{formatDifference(metric, cell.budgetDiff)}</td>
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
  const [view, setView] = useState<DailyTableView>("figures")
  const varianceRows = buildVarianceRows(days)
  const figureRows = buildFigureRows(days)
  const varianceSummary = summarizeVariance(days, totalRooms)
  const figureSummary = summarizeFigures(days, totalRooms)
  const hasOnHand = days.some((d) => d.actual == null && d.onHand != null)

  /** 行（クリックで日のグラフに表示）の共通部分 */
  const rowProps = (date: string, day: number, muted: boolean) => {
    const isSelected = selectedDate === date
    return {
      role: "button",
      tabIndex: 0,
      "aria-label": `${month}/${day}を選んで日のグラフを表示`,
      "aria-pressed": isSelected,
      onClick: () => onSelectDate(date),
      onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
        // 行の中の日付ボタンでのキー操作はボタン側に任せる（ここで止めるとボタンが押せない）
        if (e.target !== e.currentTarget) return
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onSelectDate(date)
        }
      },
      className: cn(
        "cursor-pointer border-b hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        muted && "text-muted-foreground",
        isSelected && "bg-primary/10",
      ),
    } as const
  }

  const dateCells = (date: string, day: number, dow: number, status: "actual" | "onHand" | "none") => (
    <>
      <td className="px-2 py-1.5 font-medium">
        {/* 日付リンクはダイナミックプライシングの同じ日へ遷移する（行クリックとは別動作） */}
        <button
          type="button"
          className="text-primary underline-offset-2 hover:underline"
          title={`${month}/${day} のダイナミックプライシングを開く`}
          onClick={(e) => {
            e.stopPropagation()
            const [y, m, d] = date.split("-").map(Number)
            onNavigateToPricing?.(new Date(y, m - 1, d))
          }}
        >
          {month}/{day}
        </button>
      </td>
      <td className="px-2 py-1.5">
        <Badge variant={isWeekendDow(dow) ? "default" : "outline"} className="text-xs">
          {DAY_NAMES[dow]}
        </Badge>
      </td>
      <td className="px-2 py-1.5 text-[10px]">
        {status === "actual" ? "実績" : status === "onHand" ? <span className="text-primary">予約</span> : "-"}
      </td>
    </>
  )

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1" role="group" aria-label="表の見方">
          {(
            [
              ["figures", "実数と想定値で見る"],
              ["variance", "差異で見る"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={view === value ? "default" : "outline"}
              aria-pressed={view === value}
              className="h-7 px-3 text-xs"
              onClick={() => setView(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          {view === "figures"
            ? "実数は過去が実績、先の日が今の予約実数です。予算差異は結果（先の日は AI の想定）− 予算。"
            : "実績（先の日は予約実数）と、予算・AI の想定・前年同曜日との差です。差異は結果の出た日だけ出します。"}
          {hasOnHand && " 予約の単価・売上は PMS 連携後に表示します。"}
        </p>
      </div>

      <div className="max-h-[600px] overflow-auto">
        {view === "figures" ? (
          <table className="table-sticky-head w-full min-w-[1900px] whitespace-nowrap text-xs" data-testid="daily-figures-table">
            <thead>
              <tr className="border-b bg-background">
                <th colSpan={3} className="px-2 py-1.5" />
                {FIGURE_METRICS.map((m) => (
                  <th key={m} colSpan={4} className="border-l px-2 py-1.5 text-center font-medium">
                    {METRIC_HEADERS[m]}
                  </th>
                ))}
                <th colSpan={4} className="border-l px-2 py-1.5 text-center font-medium">前年比</th>
              </tr>
              <tr className="border-b bg-background">
                <th className="px-2 py-1.5 text-left font-medium">日付</th>
                <th className="px-2 py-1.5 text-left font-medium">曜日</th>
                <th className="px-2 py-1.5 text-left font-medium">区分</th>
                {FIGURE_METRICS.map((m) => (
                  <FigureHeaders key={m} metric={m} />
                ))}
                {METRICS.map((m, i) => (
                  <th key={`y-${m}`} className={cn("px-2 py-1.5 text-right font-medium", i === 0 && "border-l")}>
                    {METRIC_HEADERS[m]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {figureRows.map((row) => (
                <tr key={row.date} {...rowProps(row.date, row.day, false)}>
                  {dateCells(row.date, row.day, row.dow, row.hasActual ? "actual" : row.hasOnHand ? "onHand" : "none")}
                  {FIGURE_METRICS.map((m) => (
                    <FigureCells key={m} metric={m} cell={row.cells[m]} onHand={row.hasOnHand} strong={m === "revenue"} />
                  ))}
                  <VarianceCells set={row.yoy} format={formatYoy} />
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2">
              <tr className="bg-muted/30 font-semibold">
                <td className="px-2 py-2" colSpan={3}>
                  月計（実績{figureSummary.actualDays}日{figureSummary.onHandDays > 0 ? `＋予約${figureSummary.onHandDays}日` : ""}）
                </td>
                {FIGURE_METRICS.map((m) => (
                  <FigureCells key={m} metric={m} cell={figureSummary.cells[m]} onHand={false} />
                ))}
                <VarianceCells set={figureSummary.yoy} format={formatYoy} />
              </tr>
            </tfoot>
          </table>
        ) : (
          <table className="table-sticky-head w-full min-w-[1150px] whitespace-nowrap text-xs" data-testid="daily-variance-table">
            <thead>
              <tr className="border-b bg-background">
                <th colSpan={3} className="px-2 py-1.5" />
                <th colSpan={5} className="border-l px-2 py-1.5 text-center font-medium">実績（先の日は予約実数）</th>
                <th colSpan={4} className="border-l px-2 py-1.5 text-center font-medium">予算差異</th>
                <th colSpan={4} className="border-l px-2 py-1.5 text-center font-medium">AI想定差異</th>
                <th colSpan={4} className="border-l px-2 py-1.5 text-center font-medium">前年比</th>
              </tr>
              <tr className="border-b bg-background">
                <th className="px-2 py-1.5 text-left font-medium">日付</th>
                <th className="px-2 py-1.5 text-left font-medium">曜日</th>
                <th className="px-2 py-1.5 text-left font-medium">区分</th>
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
              {varianceRows.map((row, i) => {
                const onHand = row.hasActual ? null : days[i].onHand
                const shown = row.actual ?? onHand
                return (
                  <tr key={row.date} {...rowProps(row.date, row.day, !row.hasActual)}>
                    {dateCells(row.date, row.day, row.dow, row.hasActual ? "actual" : onHand ? "onHand" : "none")}
                    <td className={cn("border-l px-2 py-1.5 text-right tabular-nums", onHand && "text-primary")}>{formatRooms(shown?.soldRooms)}</td>
                    <td className={cn("px-2 py-1.5 text-right tabular-nums", onHand && "text-primary")}>{formatPercent(shown?.occupancy)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatYen(shown?.adr)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatYen(shown?.revPar)}</td>
                    <td className="px-2 py-1.5 text-right font-medium tabular-nums">{formatYen(shown?.revenue)}</td>
                    <VarianceCells set={row.budget} format={formatDifference} />
                    <VarianceCells set={row.ai} format={formatDifference} />
                    <VarianceCells set={row.yoy} format={formatYoy} />
                  </tr>
                )
              })}
            </tbody>
            {varianceSummary.actual && (
              <tfoot className="border-t-2">
                <tr className="bg-muted/30 font-semibold">
                  <td className="px-2 py-2" colSpan={3}>
                    月計（実績{varianceSummary.days}日分）
                  </td>
                  <td className="border-l px-2 py-2 text-right tabular-nums">{formatRooms(varianceSummary.actual.soldRooms)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatPercent(varianceSummary.actual.occupancy)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatYen(varianceSummary.actual.adr)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatYen(varianceSummary.actual.revPar)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatYen(varianceSummary.actual.revenue)}</td>
                  <VarianceCells set={varianceSummary.budget} format={formatDifference} />
                  <VarianceCells set={varianceSummary.ai} format={formatDifference} />
                  <VarianceCells set={varianceSummary.yoy} format={formatYoy} />
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
    </div>
  )
}

function FigureHeaders({ metric }: { metric: FigureMetric }) {
  return (
    <>
      <th className="border-l px-2 py-1.5 text-right font-medium">{FIGURE_HEADERS[metric].value}</th>
      <th className="px-2 py-1.5 text-right font-medium">{FIGURE_HEADERS[metric].ai}</th>
      <th className="bg-muted/40 px-2 py-1.5 text-right font-medium">予算</th>
      <th className="px-2 py-1.5 text-right font-medium">予算差異</th>
    </>
  )
}
