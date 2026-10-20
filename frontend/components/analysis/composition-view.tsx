"use client"

// 需要構成の共通の表とグラフ（2026-10 PDF c分析02）。
// チャネル別・部屋タイプ別・利用人数別の3つを同じ見方にそろえる:
//  - 表の項目: 販売室数・稼働率・ADR・客単価・室料売上・売上構成比・DOR・平均宿泊数・前年同月比（前月比は出さない）
//  - グラフ: 構成比（販売室数・室料売上の2種）と、月のブッキングカーブ
// 客単価・DOR・平均宿泊数は人数・泊数の入った予約データ（PMS/サイトコントローラー連携）が要るため、実データでは「-」になる。
// 月のブッキングカーブも区分ごとの予約データが要るため、いまは形をサンプルで出す（必ずサンプルと明示する）。

import { useMemo, useState, type ReactNode } from "react"
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SampleDataNotice } from "@/components/sample-data-notice"
import { formatPercent, formatPt, formatRooms, formatYen } from "@/lib/format"
import { toNumber, type ChartTooltipProps } from "@/lib/chart-tooltip"
import { cn } from "@/lib/utils"

export interface CompositionRow {
  key: string
  name: string
  /** 1列目の表示（省略時は name） */
  label?: ReactNode
  soldRooms: number | null
  occupancy: number | null
  adr: number | null
  /** 客単価 = 室料売上 ÷ 宿泊人数 */
  guestUnitPrice: number | null
  revenue: number | null
  /** 売上構成比（%） */
  revenueShare: number | null
  /** 販売室数の構成比（%）。グラフに使う */
  roomsShare: number | null
  /** DOR = 宿泊人数 ÷ 販売室数 */
  dor: number | null
  /** 平均宿泊数（泊） */
  avgNights: number | null
  /** 室料売上の前年同月比（%） */
  yoy: number | null
  /** 前年同月の室料売上（その他にまとめるときに使う） */
  lastYearRevenue?: number | null
}

/** 上位 limit 件を残し、残りを「その他（N件）」1行にまとめる（チャネルは 100 を超えることもあるため上位10社 — c分析02） */
export function topWithOthers(rows: CompositionRow[], limit: number, unit: string, totalCapacityShare = false): CompositionRow[] {
  if (rows.length <= limit) return rows
  const top = rows.slice(0, limit)
  const rest = rows.slice(limit)
  const sum = (pick: (r: CompositionRow) => number | null | undefined) => {
    const values = rest.map(pick)
    return values.every((v) => v == null) ? null : values.reduce<number>((a, v) => a + (v ?? 0), 0)
  }
  const soldRooms = sum((r) => r.soldRooms)
  const revenue = sum((r) => r.revenue)
  const lastYearRevenue = rest.every((r) => r.lastYearRevenue != null) ? sum((r) => r.lastYearRevenue) : null
  const round1 = (v: number) => Math.round(v * 10) / 10
  return [
    ...top,
    {
      key: "__others",
      name: `その他（${rest.length}${unit}）`,
      soldRooms,
      occupancy: totalCapacityShare ? sum((r) => r.occupancy) : null,
      adr: soldRooms != null && revenue != null && soldRooms > 0 ? Math.round(revenue / soldRooms) : null,
      guestUnitPrice: null,
      revenue,
      revenueShare: sum((r) => r.revenueShare) != null ? round1(sum((r) => r.revenueShare) as number) : null,
      roomsShare: sum((r) => r.roomsShare) != null ? round1(sum((r) => r.roomsShare) as number) : null,
      dor: null,
      avgNights: null,
      yoy: revenue != null && lastYearRevenue != null && lastYearRevenue > 0 ? round1(((revenue - lastYearRevenue) / lastYearRevenue) * 100) : null,
      lastYearRevenue,
    },
  ]
}

function signClass(value: number | null): string {
  if (value == null || value === 0) return "text-muted-foreground"
  return value > 0 ? "text-positive" : "text-negative"
}

interface CompositionTableProps {
  labelHeader: string
  rows: CompositionRow[]
  testId?: string
  /** 表の下の注記 */
  note?: ReactNode
}

/** 需要構成の表（3つの切り口で同じ項目） */
export function CompositionTable({ labelHeader, rows, testId, note }: CompositionTableProps) {
  return (
    <div className="space-y-1.5">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] whitespace-nowrap text-xs" data-testid={testId}>
          <thead>
            <tr className="border-b">
              <th className="px-2 py-2 text-left font-medium">{labelHeader}</th>
              <th className="px-2 py-2 text-right font-medium">販売室数</th>
              <th className="px-2 py-2 text-right font-medium">稼働率</th>
              <th className="px-2 py-2 text-right font-medium">ADR</th>
              <th className="px-2 py-2 text-right font-medium">客単価</th>
              <th className="px-2 py-2 text-right font-medium">室料売上</th>
              <th className="px-2 py-2 text-right font-medium">売上構成比</th>
              <th className="px-2 py-2 text-right font-medium">DOR</th>
              <th className="px-2 py-2 text-right font-medium">平均宿泊数</th>
              <th className="px-2 py-2 text-right font-medium">前年同月比</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={cn("border-b hover:bg-muted/50", row.key === "__others" && "text-muted-foreground")}>
                <td className="px-2 py-2 font-medium">{row.label ?? row.name}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatRooms(row.soldRooms)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatPercent(row.occupancy)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatYen(row.adr)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatYen(row.guestUnitPrice)}</td>
                <td className="px-2 py-2 text-right font-medium tabular-nums">{formatYen(row.revenue)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{row.revenueShare == null ? "-" : `${row.revenueShare.toFixed(1)}%`}</td>
                <td className="px-2 py-2 text-right tabular-nums">{row.dor == null ? "-" : row.dor.toFixed(2)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{row.avgNights == null ? "-" : `${row.avgNights.toFixed(1)}泊`}</td>
                <td className={cn("px-2 py-2 text-right tabular-nums", signClass(row.yoy))}>{row.yoy == null ? "-" : formatPt(row.yoy)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && <p className="text-[10px] text-muted-foreground">{note}</p>}
    </div>
  )
}

/** 構成比の横棒（1系列。値は % ） */
function ShareBarChart({ title, data, testId }: { title: string; data: Array<{ name: string; share: number }>; testId: string }) {
  const height = Math.max(160, data.length * 22 + 30)
  const ShareTooltip = ({ active, payload }: ChartTooltipProps) => {
    if (!active || !payload?.length) return null
    const row = payload[0].payload as { name: string; share: number }
    return (
      <div className="rounded-md border bg-background px-2 py-1 text-xs shadow">
        {row.name}: {toNumber(row.share).toFixed(1)}%
      </div>
    )
  }
  return (
    <div className="rounded-lg border p-3" data-testid={testId}>
      <p className="mb-1 text-xs font-medium">{title}</p>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 36, left: 4, bottom: 4 }} barCategoryGap={4}>
          <CartesianGrid horizontal={false} stroke="currentColor" opacity={0.08} />
          <XAxis type="number" domain={[0, (max: number) => Math.max(10, Math.ceil(max / 10) * 10)]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 9 }} stroke="currentColor" opacity={0.5} />
          <YAxis type="category" dataKey="name" width={112} tick={{ fontSize: 10 }} stroke="currentColor" opacity={0.6} interval={0} />
          <Tooltip content={<ShareTooltip />} cursor={{ fill: "currentColor", opacity: 0.05 }} />
          <Bar
            dataKey="share"
            fill="var(--chart-1)"
            radius={[0, 4, 4, 0]}
            maxBarSize={14}
            label={{ position: "right", fontSize: 9, fill: "currentColor", formatter: (v: unknown) => `${toNumber(v).toFixed(1)}%` }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** 構成比のグラフ（販売室数・室料売上の2種 — c分析02） */
export function CompositionShareCharts({ rows }: { rows: CompositionRow[] }) {
  const rooms = rows.filter((r) => r.roomsShare != null).map((r) => ({ name: r.name, share: r.roomsShare as number }))
  const revenue = rows.filter((r) => r.revenueShare != null).map((r) => ({ name: r.name, share: r.revenueShare as number }))
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <ShareBarChart title="販売室数の構成比" data={rooms} testId="share-rooms" />
      <ShareBarChart title="室料売上の構成比" data={revenue} testId="share-revenue" />
    </div>
  )
}

/** 残日数 lead の時点で最終の何割が予約済みか（サンプルの形。早く埋まる区分ほど早く立ち上がる） */
function sampleProgress(lead: number, earliness: number): number {
  if (lead <= 0) return 1
  if (lead >= 180) return 0
  return Math.pow(1 - lead / 180, 1.2 + earliness * 1.4)
}

const CURVE_LEADS = [180, 150, 120, 90, 75, 60, 45, 30, 21, 14, 7, 3, 1, 0]

/**
 * 区分ごとの月のブッキングカーブ（サンプル）。区分を選んで、月の予約室数が 180日前 → 結果 でどう積み上がったかを前年と並べる。
 * 区分ごとの予約データが無いため、最終の室数（表の販売室数）に典型的な形を当てたサンプル。
 */
export function SegmentMonthCurveChart({ rows, title }: { rows: CompositionRow[]; title: string }) {
  const candidates = useMemo(() => rows.filter((r) => r.key !== "__others" && (r.soldRooms ?? 0) > 0), [rows])
  const [selected, setSelected] = useState<string | null>(null)
  const current = candidates.find((r) => r.key === selected) ?? candidates[0]
  const data = useMemo(() => {
    if (!current) return []
    const index = candidates.indexOf(current)
    const earliness = (index % 4) / 3
    const final = current.soldRooms ?? 0
    const lastYearFinal = current.yoy != null ? final / (1 + current.yoy / 100) : final * 0.95
    return CURVE_LEADS.map((lead) => ({
      lead,
      rooms: Math.round(final * sampleProgress(lead, earliness)),
      lastYear: Math.round(lastYearFinal * sampleProgress(lead, Math.max(0, earliness - 0.15))),
    }))
  }, [current, candidates])

  if (!current) return null
  const CurveTooltip = ({ active, payload }: ChartTooltipProps) => {
    if (!active || !payload?.length) return null
    const row = payload[0].payload as (typeof data)[number]
    return (
      <div className="rounded-md border bg-background px-2 py-1 text-xs shadow">
        <p className="font-medium">{row.lead === 0 ? "結果" : `${row.lead}日前`}</p>
        <p>今年: {formatRooms(row.rooms)}</p>
        <p className="text-muted-foreground">前年: {formatRooms(row.lastYear)}</p>
      </div>
    )
  }
  return (
    <div className="space-y-2 rounded-lg border p-3" data-testid="segment-month-curve">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-medium">{title}</p>
        <div className="ml-auto flex items-center gap-1.5">
          <Label htmlFor={`curve-${title}`} className="text-xs">
            区分
          </Label>
          <Select value={current.key} onValueChange={setSelected}>
            <SelectTrigger id={`curve-${title}`} className="h-7 w-44 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((r) => (
                <SelectItem key={r.key} value={r.key}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <SampleDataNotice detail="区分ごとの予約の入り方は予約データ（PMS/サイトコントローラー）連携後に表示します。いまは最終の販売室数に典型的な形を当てたサンプルです。" />
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 6, right: 16, left: 4, bottom: 4 }}>
          <CartesianGrid stroke="currentColor" opacity={0.08} />
          <XAxis
            dataKey="lead"
            type="number"
            domain={[0, 180]}
            reversed
            ticks={[180, 120, 90, 60, 30, 14, 0]}
            tickFormatter={(v) => (v === 0 ? "結果" : `${v}日前`)}
            tick={{ fontSize: 9 }}
            stroke="currentColor"
            opacity={0.5}
          />
          <YAxis tickFormatter={(v) => `${v}室`} tick={{ fontSize: 9 }} stroke="currentColor" opacity={0.5} width={48} />
          <Tooltip content={<CurveTooltip />} />
          <Line type="monotone" dataKey="rooms" name="今年" stroke="var(--chart-1)" strokeWidth={2} dot={{ r: 2 }} />
          <Line type="monotone" dataKey="lastYear" name="前年" stroke="currentColor" strokeOpacity={0.45} strokeWidth={2} strokeDasharray="4 3" dot={false} />
        </LineChart>
      </ResponsiveContainer>
      <div className="flex gap-4 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="h-0.5 w-4" style={{ backgroundColor: "var(--chart-1)" }} aria-hidden />
          今年（{current.name}）
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-0 w-4 border-t-2 border-dashed border-current opacity-50" aria-hidden />
          前年同月
        </span>
      </div>
    </div>
  )
}
