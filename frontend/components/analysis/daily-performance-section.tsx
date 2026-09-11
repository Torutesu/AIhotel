"use client"

// 日別パフォーマンス＋月間サマリー（U-7 / U-11 / U-15）
// 数値は GET /api/v1/dashboard/kpi の summary / comparison / dailyTrend を出所とする。
// 以前はシード付き乱数で生成したダミー値を表示していたが、実データへ置き換えた。

import { useCallback, useEffect, useMemo, useState } from "react"
import { TrendingUp } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { MonthPicker } from "@/components/month-picker"
import { useAuth } from "@/components/auth-provider"
import { useWeekend } from "@/hooks/use-weekend"
import { api, ApiClientError, type DashboardKpi } from "@/lib/api"
import { DAY_NAMES, monthLabel, parseMonthStr, startOfToday } from "@/lib/date"
import { formatPercent, formatPt, formatRooms, formatYen } from "@/lib/format"

interface DailyRow {
  /** "M/d" 形式の表示用日付 */
  label: string
  /** "yyyy-MM-dd" */
  date: string
  day: number
  dow: number
  isActual: boolean
  occupancy: number | null
  adr: number | null
  soldRooms: number | null
  revPar: number | null
  revenue: number | null
  /** 前年同日比（室料売上ベース）。前年実績が無ければ null */
  yoy: number | null
}

interface DailyPerformanceSectionProps {
  /** 対象月（"YYYY-MM"）。省略時は内部stateで管理する */
  targetMonth?: string
  onTargetMonthChange?: (value: string) => void
  /** 日別テーブルの日付からダイナミックプライシング画面の同じ日へ遷移する */
  onNavigateToPricing?: (date: Date) => void
  /** 行クリックで宿泊日が選ばれたことを親に伝える（ブッキングカーブとの連動用） */
  onSelectStayDate?: (date: Date) => void
}

/** 実績のある行から最大／最小の日を選ぶ */
function pickExtreme(
  rows: DailyRow[],
  key: "adr" | "occupancy" | "revPar",
  mode: "max" | "min",
): DailyRow | null {
  const candidates = rows.filter((r) => r.isActual && r[key] != null)
  if (candidates.length === 0) return null
  return candidates.reduce((best, row) => {
    const a = row[key] as number
    const b = best[key] as number
    return mode === "max" ? (a > b ? row : best) : a < b ? row : best
  }, candidates[0])
}

function extremeLabel(row: DailyRow | null): string {
  if (!row) return "実績なし"
  return `${row.date.split("-")[1].replace(/^0/, "")}月${row.day}日（${DAY_NAMES[row.dow]}）`
}

export function DailyPerformanceSection({
  targetMonth: targetMonthProp,
  onTargetMonthChange,
  onNavigateToPricing,
  onSelectStayDate,
}: DailyPerformanceSectionProps = {}) {
  const { hotelId, hotel } = useAuth()
  const { isWeekendDow } = useWeekend()

  const [internalTargetMonth, setInternalTargetMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  })
  const targetMonth = targetMonthProp ?? internalTargetMonth
  const handleTargetMonthChange = (value: string) => {
    setInternalTargetMonth(value)
    onTargetMonthChange?.(value)
  }

  const { year, month } = useMemo(() => parseMonthStr(targetMonth), [targetMonth])
  const targetMonthLabel = monthLabel(year, month)

  const [kpi, setKpi] = useState<DashboardKpi | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedStayDate, setSelectedStayDate] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!hotelId) return
    setLoading(true)
    setError(null)
    try {
      setKpi(await api.dashboardKpi(hotelId, year, month))
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "日別実績の取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId, year, month])

  useEffect(() => {
    load()
  }, [load])

  const totalRooms = hotel?.totalRooms ?? null

  const rows = useMemo<DailyRow[]>(() => {
    if (!kpi) return []
    return kpi.dailyTrend.map((row) => {
      const [, m, d] = row.date.split("-")
      const occupancy = row.isActual ? row.occupancy : row.predictedOccupancy
      const adr = row.isActual ? row.adr : row.predictedAdr
      const soldRooms =
        totalRooms != null && occupancy != null ? Math.round(occupancy * totalRooms) : null
      const revPar = occupancy != null && adr != null ? occupancy * adr : null
      const revenue = soldRooms != null && adr != null ? soldRooms * adr : null
      const lastYearRevPar =
        row.lastYearOccupancy != null && row.lastYearAdr != null
          ? row.lastYearOccupancy * row.lastYearAdr
          : null
      return {
        label: `${Number(m)}/${Number(d)}`,
        date: row.date,
        day: Number(d),
        dow: new Date(row.date).getDay(),
        isActual: row.isActual,
        occupancy,
        adr,
        soldRooms,
        revPar,
        revenue,
        yoy:
          revPar != null && lastYearRevPar != null && lastYearRevPar > 0
            ? (revPar - lastYearRevPar) / lastYearRevPar - 0
            : null,
      }
    })
  }, [kpi, totalRooms])

  const extremes = useMemo(
    () => ({
      highestAdr: pickExtreme(rows, "adr", "max"),
      lowestAdr: pickExtreme(rows, "adr", "min"),
      highestOcc: pickExtreme(rows, "occupancy", "max"),
      lowestOcc: pickExtreme(rows, "occupancy", "min"),
      highestRevPar: pickExtreme(rows, "revPar", "max"),
      lowestRevPar: pickExtreme(rows, "revPar", "min"),
    }),
    [rows],
  )

  const today = useMemo(() => startOfToday(), [])
  const summary = kpi?.summary ?? null
  const hasActuals = (summary?.actualDays ?? 0) > 0
  const toDate = kpi?.comparison?.toDate ?? null

  if (error) {
    return (
      <Card>
        <CardContent className="py-2">
          <ErrorState message={error} onRetry={load} />
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      {/* 対象月セレクタ＋月間サマリー */}
      <Card>
        <CardContent className="px-3 py-2.5">
          <div className="mb-2.5 flex flex-wrap items-center gap-3">
            {targetMonthProp === undefined ? (
              <div className="flex items-center gap-1.5">
                <Label htmlFor="target-month-daily" className="whitespace-nowrap text-xs">
                  対象月
                </Label>
                <MonthPicker
                  id="target-month-daily"
                  value={targetMonth}
                  onChange={handleTargetMonthChange}
                  className="h-8 text-xs"
                />
              </div>
            ) : (
              <h3 className="text-sm font-medium">{targetMonthLabel}のサマリー</h3>
            )}
            <p className="ml-auto text-[10px] text-muted-foreground">
              ※ 実績が確定した日のみを集計しています（AI予測は含みません）
            </p>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 gap-3 border-t pt-2.5 sm:grid-cols-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : !summary || !hasActuals ? (
            <div className="rounded-lg border border-dashed bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
              <p className="font-medium text-foreground">{targetMonthLabel}の実績は未登録です</p>
              <p className="mt-1">
                日次実績（DailyData）がまだ1日も登録されていないため、月間サマリーを算出できません。
                「0」は実績ゼロではなく未登録を意味するため表示していません。
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 border-t pt-2.5 sm:grid-cols-3">
              <div className="flex flex-col">
                <p className="mb-0.5 text-xs text-muted-foreground">月間ADR</p>
                <div className="mb-0.5 text-lg font-semibold">{formatYen(summary.adr)}</div>
                {toDate?.budgetAdrRatio != null && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <TrendingUp className="h-3 w-3" aria-hidden />
                    対予算 {formatPercent(toDate.budgetAdrRatio)}
                  </span>
                )}
                {toDate?.lastYearAdrRatio != null && (
                  <span className="text-xs text-muted-foreground">
                    対前年 {formatPercent(toDate.lastYearAdrRatio)}
                  </span>
                )}
              </div>

              <div className="flex flex-col">
                <p className="mb-0.5 text-xs text-muted-foreground">月間稼働率</p>
                <div className="mb-0.5 text-lg font-semibold">
                  {formatPercent(summary.occupancyRate)}
                </div>
                {toDate?.budgetOccupancyRatio != null && (
                  <span className="text-xs text-muted-foreground">
                    対予算 {formatPercent(toDate.budgetOccupancyRatio)}
                  </span>
                )}
                {toDate?.lastYearOccupancyRatio != null && (
                  <span className="text-xs text-muted-foreground">
                    対前年 {formatPercent(toDate.lastYearOccupancyRatio)}
                  </span>
                )}
              </div>

              <div className="flex flex-col">
                <p className="mb-0.5 text-xs text-muted-foreground">月間REV-Per</p>
                <div className="mb-0.5 text-lg font-semibold">{formatYen(summary.revPar)}</div>
                <span className="text-xs text-muted-foreground">
                  室料売上 {formatYen(summary.roomRevenue)}
                </span>
              </div>

              {[
                { label: "月間最高ADR日", row: extremes.highestAdr, value: formatYen(extremes.highestAdr?.adr) },
                {
                  label: "月間最高稼働率日",
                  row: extremes.highestOcc,
                  value: formatPercent(extremes.highestOcc?.occupancy),
                },
                {
                  label: "月間最高REV-Per日",
                  row: extremes.highestRevPar,
                  value: formatYen(extremes.highestRevPar?.revPar),
                },
                { label: "月間最低ADR日", row: extremes.lowestAdr, value: formatYen(extremes.lowestAdr?.adr) },
                {
                  label: "月間最低稼働率日",
                  row: extremes.lowestOcc,
                  value: formatPercent(extremes.lowestOcc?.occupancy),
                },
                {
                  label: "月間最低REV-Per日",
                  row: extremes.lowestRevPar,
                  value: formatYen(extremes.lowestRevPar?.revPar),
                },
              ].map((item) => (
                <div key={item.label} className="mt-1 flex flex-col border-t pt-2">
                  <p className="mb-0.5 text-xs text-muted-foreground">{item.label}</p>
                  <div className="mb-0.5 text-lg font-semibold">{item.row ? item.value : "-"}</div>
                  <p className="text-xs text-muted-foreground">{extremeLabel(item.row)}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 日別パフォーマンステーブル */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">
            日別パフォーマンス（{targetMonthLabel}）
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            行をクリックすると、その日のブッキングカーブを予約動向に表示します。
            実績が確定していない日はAI予測値を表示します
            {totalRooms == null && "（客室数が取得できないため販売室数・室料売上は算出できません）"}
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <Skeleton className="h-64 w-full" />
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {targetMonthLabel}の日別データがありません。
            </p>
          ) : (
            <div className="max-h-[560px] overflow-y-auto overflow-x-auto">
              <table className="table-sticky-head w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="px-2 py-2 text-left font-medium">日付</th>
                    <th className="px-2 py-2 text-left font-medium">曜日</th>
                    <th className="px-2 py-2 text-right font-medium">販売室数</th>
                    <th className="px-2 py-2 text-right font-medium">稼働率</th>
                    <th className="px-2 py-2 text-right font-medium">ADR</th>
                    <th className="px-2 py-2 text-right font-medium">REV-Per</th>
                    <th className="px-2 py-2 text-right font-medium">室料売上</th>
                    <th className="px-2 py-2 text-center font-medium">前年比</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const isPast = new Date(row.date) < today
                    const isSelected = selectedStayDate === row.date
                    const selectStay = () => {
                      setSelectedStayDate(row.date)
                      const [y, m, d] = row.date.split("-").map(Number)
                      onSelectStayDate?.(new Date(y, m - 1, d))
                    }
                    return (
                      <tr
                        key={row.date}
                        // 行全体をクリック／キーボードで選択できるようにする（U-14）
                        role="button"
                        tabIndex={0}
                        aria-label={`${row.label}のブッキングカーブを表示`}
                        aria-pressed={isSelected}
                        onClick={selectStay}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            selectStay()
                          }
                        }}
                        className={`cursor-pointer border-b hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                          isPast ? "opacity-70" : ""
                        } ${isSelected ? "bg-primary/10" : ""}`}
                      >
                        <td className="px-2 py-2 font-medium">
                          {/* 日付リンクはダイナミックプライシングの同じ日へ遷移する（行クリックとは別動作） */}
                          <button
                            type="button"
                            className="text-primary underline-offset-2 hover:underline"
                            title={`${row.label} のダイナミックプライシングを開く`}
                            onClick={(e) => {
                              e.stopPropagation()
                              const [y, m, d] = row.date.split("-").map(Number)
                              onNavigateToPricing?.(new Date(y, m - 1, d))
                            }}
                          >
                            {row.label}
                          </button>
                        </td>
                        <td className="px-2 py-2">
                          <Badge
                            variant={isWeekendDow(row.dow) ? "default" : "outline"}
                            className="text-xs"
                          >
                            {DAY_NAMES[row.dow]}
                          </Badge>
                        </td>
                        <td className="px-2 py-2 text-right">{formatRooms(row.soldRooms)}</td>
                        <td className="px-2 py-2 text-right">
                          <span
                            className={
                              row.occupancy == null
                                ? ""
                                : row.occupancy >= 0.9
                                  ? "font-medium text-positive"
                                  : row.occupancy < 0.7
                                    ? "text-negative"
                                    : ""
                            }
                          >
                            {formatPercent(row.occupancy)}
                          </span>
                          {!row.isActual && row.occupancy != null && (
                            <span className="ml-1 text-[9px] text-muted-foreground">AI</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right">{formatYen(row.adr)}</td>
                        <td className="px-2 py-2 text-right">{formatYen(row.revPar)}</td>
                        <td className="px-2 py-2 text-right font-medium">{formatYen(row.revenue)}</td>
                        <td className="px-2 py-2 text-center">
                          {row.yoy == null ? (
                            <span className="text-muted-foreground">-</span>
                          ) : (
                            <span className={row.yoy >= 0 ? "text-positive" : "text-negative"}>
                              {formatPt(row.yoy * 100)}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                {summary && hasActuals && (
                  <tfoot className="border-t-2">
                    <tr className="bg-muted/30">
                      <td className="px-2 py-2 font-semibold" colSpan={2}>
                        当月実績（{summary.actualDays}日分）
                      </td>
                      <td className="px-2 py-2 text-right font-semibold">
                        {formatRooms(summary.soldRooms)}
                      </td>
                      <td className="px-2 py-2 text-right font-semibold">
                        {formatPercent(summary.occupancyRate)}
                      </td>
                      <td className="px-2 py-2 text-right font-semibold">{formatYen(summary.adr)}</td>
                      <td className="px-2 py-2 text-right font-semibold">
                        {formatYen(summary.revPar)}
                      </td>
                      <td className="px-2 py-2 text-right font-semibold">
                        {formatYen(summary.roomRevenue)}
                      </td>
                      <td className="px-2 py-2 text-center font-semibold">
                        {toDate?.lastYearRevenueRatio != null
                          ? formatPercent(toDate.lastYearRevenueRatio)
                          : "-"}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}
