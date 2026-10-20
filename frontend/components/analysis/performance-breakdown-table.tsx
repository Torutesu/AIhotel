"use client"

// 曜日別・日のタイプ別パフォーマンスの共通の表（PDF c分析01実績推移2）。
// 前月以前は実績、当月以降は 実績＋予約（今の予約室数）。項目は日別パフォーマンスと同じく 販売室数〜前年比。
// 予約の単価は PMS 連携後のため、ADR・REV-Per・室料売上は結果の出た日だけで出す。
// 行をクリックすると対象の日（「1(月)・2(火)」）を表示する（日のタイプは対象日が見えないため）。

import { Fragment, useState, type ReactNode } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"

import { DAY_NAMES, parseDateStr } from "@/lib/date"
import { formatPercent, formatPt, formatRooms, formatSignedPercent, formatYen } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { PerformanceRow } from "@/lib/api"

/** 対象日の表示（"1(月)・2(火)"） */
export function formatTargetDates(dates: string[]): string {
  return dates
    .map((d) => {
      const date = parseDateStr(d)
      return `${date.getDate()}(${DAY_NAMES[date.getDay()]})`
    })
    .join("・")
}

export interface PerformanceYoy {
  soldRooms: number | null
  occupancy: number | null
  adr: number | null
  revenue: number | null
}

/**
 * 前年比（前年同曜日の実績と比べる）。販売室数・稼働率は 実績＋予約 で比べ、
 * ADR・室料売上は結果の出た日だけの値なので、予約の日を含む行では比べない（同じ日の集合で比べられないため）
 */
export function performanceYoy(row: PerformanceRow): PerformanceYoy {
  const ly = row.lastYear
  if (!ly) return { soldRooms: null, occupancy: null, adr: null, revenue: null }
  const allActual = row.actualDays === row.days && ly.days === row.days
  const growth = (a: number | null, b: number | null) => (a == null || b == null || b === 0 ? null : a / b - 1)
  return {
    soldRooms: ly.days === row.days ? growth(row.soldRooms, ly.soldRooms) : null,
    occupancy: row.occupancy != null && ly.occupancy != null ? row.occupancy - ly.occupancy : null,
    adr: allActual ? growth(row.adr, ly.adr) : null,
    revenue: allActual ? growth(row.revenue, ly.revenue) : null,
  }
}

function signClass(value: number | null): string {
  if (value == null || value === 0) return "text-muted-foreground"
  return value > 0 ? "text-positive" : "text-negative"
}

export interface BreakdownTableRow {
  key: string
  /** 1列目（曜日・日のタイプ名） */
  label: ReactNode
  /** 開いたときの見出しに使う名前 */
  name: string
  highlight?: boolean
  row: PerformanceRow
}

interface PerformanceBreakdownTableProps {
  /** 1列目の見出し（曜日・日のタイプ） */
  labelHeader: string
  rows: BreakdownTableRow[]
  testId?: string
}

export function PerformanceBreakdownTable({ labelHeader, rows, testId }: PerformanceBreakdownTableProps) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] whitespace-nowrap text-xs" data-testid={testId}>
        <thead>
          <tr className="border-b">
            <th colSpan={7} className="px-2 py-1.5" />
            <th colSpan={4} className="border-l px-2 py-1.5 text-center font-medium">前年比</th>
          </tr>
          <tr className="border-b">
            <th className="px-2 py-2 text-left font-medium">{labelHeader}</th>
            <th className="px-2 py-2 text-right font-medium">日数</th>
            <th className="px-2 py-2 text-right font-medium">販売室数（うち予約）</th>
            <th className="px-2 py-2 text-right font-medium">稼働率</th>
            <th className="px-2 py-2 text-right font-medium">ADR</th>
            <th className="px-2 py-2 text-right font-medium">REV-Per</th>
            <th className="px-2 py-2 text-right font-medium">室料売上</th>
            <th className="border-l px-2 py-2 text-right font-medium">販売室数</th>
            <th className="px-2 py-2 text-right font-medium">稼働率</th>
            <th className="px-2 py-2 text-right font-medium">ADR</th>
            <th className="px-2 py-2 text-right font-medium">室料売上</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, label, name, highlight, row }) => {
            const open = openKey === key
            const yoy = performanceYoy(row)
            return (
              <Fragment key={key}>
                <tr
                  role="button"
                  tabIndex={0}
                  aria-expanded={open}
                  aria-label={`${name}の対象日を${open ? "閉じる" : "表示"}`}
                  onClick={() => setOpenKey(open ? null : key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      setOpenKey(open ? null : key)
                    }
                  }}
                  className={cn(
                    "cursor-pointer border-b hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    highlight && "bg-primary/5",
                  )}
                >
                  <td className="px-2 py-2 font-medium">
                    <span className="inline-flex items-center gap-1">
                      {open ? <ChevronDown className="h-3 w-3" aria-hidden /> : <ChevronRight className="h-3 w-3" aria-hidden />}
                      {label}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{row.days}日</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {formatRooms(row.soldRooms)}
                    {row.onHandRooms > 0 && <span className="ml-1 text-primary">（{formatRooms(row.onHandRooms)}）</span>}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatPercent(row.occupancy)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatYen(row.adr)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatYen(row.revPar)}</td>
                  <td className="px-2 py-2 text-right font-medium tabular-nums">{formatYen(row.revenue)}</td>
                  <td className={cn("border-l px-2 py-2 text-right tabular-nums", signClass(yoy.soldRooms))}>
                    {yoy.soldRooms == null ? "-" : formatPt(yoy.soldRooms * 100)}
                  </td>
                  <td className={cn("px-2 py-2 text-right tabular-nums", signClass(yoy.occupancy))}>{formatSignedPercent(yoy.occupancy)}</td>
                  <td className={cn("px-2 py-2 text-right tabular-nums", signClass(yoy.adr))}>{yoy.adr == null ? "-" : formatPt(yoy.adr * 100)}</td>
                  <td className={cn("px-2 py-2 text-right tabular-nums", signClass(yoy.revenue))}>
                    {yoy.revenue == null ? "-" : formatPt(yoy.revenue * 100)}
                  </td>
                </tr>
                {open && (
                  <tr className="border-b bg-muted/30">
                    <td colSpan={11} className="whitespace-normal px-3 py-2 text-xs" data-testid="breakdown-dates">
                      <span className="mr-2 text-muted-foreground">対象日</span>
                      {row.dates.length > 0 ? formatTargetDates(row.dates) : "なし"}
                      {row.actualDays < row.days && (
                        <span className="ml-2 text-muted-foreground">（うち予約の日 {row.days - row.actualDays}日）</span>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
