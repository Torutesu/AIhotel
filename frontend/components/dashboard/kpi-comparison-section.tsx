"use client"

// 月初比較・日付比較（U-5 / F-DASH-04）
// GET /api/v1/dashboard/kpi/comparison が返す KpiSnapshot を唯一の出所とする。
// スナップショットが未取得の月は空配列が返るため、値を生成せず空状態を表示する。

import { useCallback, useEffect, useMemo, useState } from "react"
import { CalendarIcon } from "lucide-react"
import { format } from "date-fns"
import { ja } from "date-fns/locale/ja"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { api, ApiClientError, type DashboardKpi, type KpiSnapshot } from "@/lib/api"
import { toDateStr } from "@/lib/date"
import { formatPercent, formatYen } from "@/lib/format"

interface KpiComparisonSectionProps {
  year: number
  month: number
  /** 現在の当月実績（比較の「現在」側） */
  summary: DashboardKpi["summary"] | null
}

interface ComparisonRow {
  label: string
  before: string
  current: string
  diffLabel: string
  diffRate: number | null
}

function diffLabelYen(current: number, before: number): string {
  const diff = current - before
  return `${diff >= 0 ? "+" : "-"}¥${Math.abs(Math.round(diff)).toLocaleString()}`
}

function rate(current: number | null, before: number | null): number | null {
  if (current == null || before == null || before === 0) return null
  return (current - before) / before
}

/** 現在の実績とスナップショットを並べた比較行を作る（欠損値は「-」のまま扱う） */
function buildRows(summary: DashboardKpi["summary"], snapshot: KpiSnapshot): ComparisonRow[] {
  const rows: ComparisonRow[] = [
    {
      label: "室料売上",
      before: formatYen(snapshot.revenue),
      current: formatYen(summary.roomRevenue),
      diffLabel: snapshot.revenue != null ? diffLabelYen(summary.roomRevenue, snapshot.revenue) : "-",
      diffRate: rate(summary.roomRevenue, snapshot.revenue),
    },
    {
      label: "販売室数",
      before: snapshot.soldRooms != null ? `${snapshot.soldRooms.toLocaleString()}室` : "-",
      current: `${summary.soldRooms.toLocaleString()}室`,
      diffLabel:
        snapshot.soldRooms != null
          ? `${summary.soldRooms - snapshot.soldRooms >= 0 ? "+" : ""}${(
              summary.soldRooms - snapshot.soldRooms
            ).toLocaleString()}室`
          : "-",
      diffRate: rate(summary.soldRooms, snapshot.soldRooms),
    },
    {
      label: "ADR",
      before: formatYen(snapshot.adr),
      current: formatYen(summary.adr),
      diffLabel: snapshot.adr != null ? diffLabelYen(summary.adr, snapshot.adr) : "-",
      diffRate: rate(summary.adr, snapshot.adr),
    },
    {
      label: "稼働率",
      before: formatPercent(snapshot.occupancy),
      current: formatPercent(summary.occupancyRate),
      diffLabel:
        snapshot.occupancy != null
          ? `${summary.occupancyRate - snapshot.occupancy >= 0 ? "+" : ""}${(
              (summary.occupancyRate - snapshot.occupancy) *
              100
            ).toFixed(1)}pt`
          : "-",
      diffRate: rate(summary.occupancyRate, snapshot.occupancy),
    },
    {
      label: "REV-Per",
      before: formatYen(snapshot.revPar),
      current: formatYen(summary.revPar),
      diffLabel: snapshot.revPar != null ? diffLabelYen(summary.revPar, snapshot.revPar) : "-",
      diffRate: rate(summary.revPar, snapshot.revPar),
    },
  ]
  return rows
}

function ComparisonTable({ rows, beforeLabel }: { rows: ComparisonRow[]; beforeLabel: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b bg-muted/30">
            <th className="border-r px-2 py-1.5 text-left font-medium">指標</th>
            <th className="whitespace-nowrap border-r px-2 py-1.5 text-right font-medium">
              {beforeLabel}
            </th>
            <th className="border-r px-2 py-1.5 text-right font-medium">現在</th>
            <th className="px-2 py-1.5 text-right font-medium">増減</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b hover:bg-muted/20">
              <td className="whitespace-nowrap border-r bg-muted/10 px-2 py-1.5 font-medium">
                {row.label}
              </td>
              <td className="whitespace-nowrap border-r px-2 py-1.5 text-right text-muted-foreground">
                {row.before}
              </td>
              <td className="whitespace-nowrap border-r px-2 py-1.5 text-right font-semibold">
                {row.current}
              </td>
              <td
                className={`whitespace-nowrap px-2 py-1.5 text-right ${
                  row.diffRate == null
                    ? "text-muted-foreground"
                    : row.diffRate >= 0
                      ? "text-positive"
                      : "text-negative"
                }`}
              >
                {row.diffLabel}
                {row.diffRate != null && (
                  <span className="ml-1 text-[10px]">
                    ({row.diffRate >= 0 ? "+" : ""}
                    {(row.diffRate * 100).toFixed(1)}%)
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** スナップショット未取得の空状態 */
function SnapshotEmptyState({ detail }: { detail: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
      <p className="font-medium text-foreground">スナップショットが未取得です</p>
      <p className="mt-1">{detail}</p>
    </div>
  )
}

export function KpiComparisonSection({ year, month, summary }: KpiComparisonSectionProps) {
  const { hotelId } = useAuth()

  const [snapshots, setSnapshots] = useState<KpiSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [comparisonDate, setComparisonDate] = useState<Date | undefined>(undefined)

  const load = useCallback(async () => {
    if (!hotelId) return
    setLoading(true)
    setError(null)
    try {
      setSnapshots(await api.kpiComparison(hotelId, year, month))
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "KPI比較データの取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId, year, month])

  useEffect(() => {
    load()
  }, [load])

  /** 月初比較: 対象月に紐づく最も古いスナップショット */
  const monthStartSnapshot = snapshots[0] ?? null

  /** 日付比較: 選択した日のスナップショット。未選択なら最新のもの */
  const dateSnapshot = useMemo(() => {
    if (snapshots.length === 0) return null
    if (!comparisonDate) return snapshots[snapshots.length - 1]
    const key = toDateStr(comparisonDate)
    return snapshots.find((s) => s.snapshotDate.slice(0, 10) === key) ?? null
  }, [snapshots, comparisonDate])

  const availableDates = useMemo(
    () => snapshots.map((s) => new Date(s.snapshotDate)),
    [snapshots],
  )

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-base font-medium">月初比較・日付比較</CardTitle>
        <p className="text-xs text-muted-foreground">
          日次で記録したKPIスナップショットと現在の実績を比較します（GET /dashboard/kpi/comparison）
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-muted-foreground">月初比較</h3>
                {monthStartSnapshot && (
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    vs {format(new Date(monthStartSnapshot.snapshotDate), "M月d日", { locale: ja })}時点
                  </span>
                )}
              </div>
              {!summary ? (
                <SnapshotEmptyState detail="当月の実績がまだ取得できていません。" />
              ) : monthStartSnapshot ? (
                <ComparisonTable
                  rows={buildRows(summary, monthStartSnapshot)}
                  beforeLabel={`${format(new Date(monthStartSnapshot.snapshotDate), "M/d", { locale: ja })}時点`}
                />
              ) : (
                <SnapshotEmptyState detail={`${year}年${month}月のKPIスナップショットがまだ記録されていません。日次バッチで蓄積されると比較できるようになります。`} />
              )}
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-muted-foreground">日付比較</h3>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={snapshots.length === 0}
                    >
                      <CalendarIcon className="mr-1 h-3 w-3" aria-hidden />
                      {comparisonDate
                        ? format(comparisonDate, "M月d日", { locale: ja })
                        : "比較日を選択"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar
                      mode="single"
                      locale={ja}
                      selected={comparisonDate}
                      onSelect={setComparisonDate}
                      disabled={(date) =>
                        !availableDates.some((d) => toDateStr(d) === toDateStr(date))
                      }
                      autoFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              {!summary ? (
                <SnapshotEmptyState detail="当月の実績がまだ取得できていません。" />
              ) : snapshots.length === 0 ? (
                <SnapshotEmptyState detail={`${year}年${month}月のKPIスナップショットがまだ記録されていません。日次バッチで蓄積されると比較できるようになります。`} />
              ) : dateSnapshot ? (
                <ComparisonTable
                  rows={buildRows(summary, dateSnapshot)}
                  beforeLabel={`${format(new Date(dateSnapshot.snapshotDate), "M/d", { locale: ja })}時点`}
                />
              ) : (
                <SnapshotEmptyState detail="選択した日のスナップショットはありません。カレンダーで選択できる日から選び直してください。" />
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
