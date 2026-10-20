"use client"

// 日別パフォーマンス＋月間サマリー（U-7 / U-11 / U-15）
// 月間サマリーは事実のみ（PDF c分析01実績推移1）: 前月以前は実績、当月以降は 実績＋今の予約。AI の予測は含めない。
// 販売室数・稼働率は GET /api/v1/analysis/daily-performance の実績＋予約実数、ADR・REV-Per・売上と対予算・対前年は
// GET /api/v1/dashboard/kpi の summary / comparison（結果の出た日だけ。予約の単価は PMS 連携後）。
// 日別の表とグラフは GET /api/v1/analysis/daily-performance（2026-10 の画面修正）:
// 実数と想定値／差異の表、月のグラフ（差異の推移）、日のグラフ（180日前 → 結果）。

import { useMemo, useState } from "react"
import { TrendingUp } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { MonthPicker } from "@/components/month-picker"
import { useAuth } from "@/components/auth-provider"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, type DailyPerformance, type DashboardKpi } from "@/lib/api"
import { DailyVarianceTable } from "@/components/analysis/daily-variance-table"
import { summarizeFigures } from "@/components/analysis/performance-variance"
import { VarianceDayCharts, VarianceMonthCharts } from "@/components/analysis/variance-charts"
import { DAY_NAMES, monthLabel, parseDateStr, parseMonthStr } from "@/lib/date"
import { formatPercent, formatRooms, formatYen } from "@/lib/format"

interface DailyRow {
  /** "yyyy-MM-dd" */
  date: string
  day: number
  dow: number
  occupancy: number | null
  adr: number | null
  revPar: number | null
}

interface DailyPerformanceSectionProps {
  /** 対象月（"YYYY-MM"）。省略時は内部stateで管理する */
  targetMonth?: string
  onTargetMonthChange?: (value: string) => void
  /** 日別テーブルの日付からダイナミックプライシング画面の同じ日へ遷移する */
  onNavigateToPricing?: (date: Date) => void
  /** 行・日付の選択で宿泊日が選ばれたことを親に伝える（予約動向のブッキングカーブを同じ日にそろえる。画面は移動しない） */
  onSelectStayDate?: (date: Date) => void
  /** 予約動向のブッキングカーブを開く */
  onOpenBookingCurve?: () => void
}

/** 実績の行から最大／最小の日を選ぶ */
function pickExtreme(
  rows: DailyRow[],
  key: "adr" | "occupancy" | "revPar",
  mode: "max" | "min",
): DailyRow | null {
  const candidates = rows.filter((r) => r[key] != null)
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
  onOpenBookingCurve,
}: DailyPerformanceSectionProps = {}) {
  const { hotelId } = useAuth()

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

  const [selectedStayDate, setSelectedStayDate] = useState<string | null>(null)

  // ホテル・期間を切り替えた直後に前の条件のレスポンスが遅れて返っても使わない（#91）
  const {
    data: kpiData,
    loading,
    error,
    reload: load,
  } = useApiQuery<DashboardKpi | null>(
    hotelId ? () => api.dashboardKpi(hotelId, year, month) : null,
    [hotelId, year, month],
    "日別実績の取得に失敗しました",
  )
  const kpi = kpiData ?? null

  const {
    data: performance,
    loading: performanceLoading,
    error: performanceError,
    reload: reloadPerformance,
  } = useApiQuery<DailyPerformance>(
    hotelId ? () => api.dailyPerformance(hotelId, year, month) : null,
    [hotelId, year, month],
    "日別パフォーマンスの取得に失敗しました",
  )
  // 日のグラフの対象日: 行で選んだ日。選ぶまでは月の最後の実績日
  const latestActualDate = useMemo(
    () => [...(performance?.days ?? [])].reverse().find((d) => d.actual != null)?.date ?? null,
    [performance],
  )
  const chartDate = selectedStayDate && selectedStayDate.startsWith(targetMonth) ? selectedStayDate : latestActualDate
  /** 日のグラフの日付を選ぶ（表の行・日付の選択。予約動向のブッキングカーブにも伝える） */
  const selectChartDate = (date: string) => {
    setSelectedStayDate(date)
    const [y, m, d] = date.split("-").map(Number)
    onSelectStayDate?.(new Date(y, m - 1, d))
  }

  // 月間最高・最低の日は結果の出た日だけ（AI の予測は含めない）
  const rows = useMemo<DailyRow[]>(
    () =>
      (performance?.days ?? [])
        .filter((d) => d.actual != null)
        .map((d) => ({
          date: d.date,
          day: Number(d.date.slice(8, 10)),
          dow: parseDateStr(d.date).getDay(),
          occupancy: d.actual?.occupancy ?? null,
          adr: d.actual?.adr ?? null,
          revPar: d.actual?.revPar ?? null,
        })),
    [performance],
  )

  // 販売室数・稼働率 = 実績＋今の予約（事実のみ。先の月は予約の分だけなので低く出る）
  const booked = useMemo(() => (performance ? summarizeFigures(performance.days, performance.totalRooms) : null), [performance])

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

  const summary = kpi?.summary ?? null
  const hasActuals = (summary?.actualDays ?? 0) > 0
  const hasBookings = (booked?.onHandDays ?? 0) > 0
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
              ※ 事実のみを集計しています（AIの予測は含みません）。前月以前は実績、当月以降は 実績＋今の予約 のため、先の月は低く出ます。
              ADR・REV-Per・売上は結果の出た日だけです（予約の単価は PMS 連携後）
            </p>
          </div>

          {loading || performanceLoading ? (
            <div className="grid grid-cols-1 gap-3 border-t pt-2.5 sm:grid-cols-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : (!summary || !hasActuals) && !hasBookings ? (
            <div className="rounded-lg border border-dashed bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
              <p className="font-medium text-foreground">{targetMonthLabel}の実績・予約は未登録です</p>
              <p className="mt-1">
                日次実績（DailyData）も予約の記録もまだ無いため、月間サマリーを算出できません。
                「0」は実績ゼロではなく未登録を意味するため表示していません。
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 border-t pt-2.5 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col" data-testid="summary-sold-rooms">
                <p className="mb-0.5 text-xs text-muted-foreground">
                  月間販売室数{hasBookings ? "（実績＋予約）" : ""}
                </p>
                <div className="mb-0.5 text-lg font-semibold">{formatRooms(booked?.cells.soldRooms.value)}</div>
                {hasBookings && (
                  <span className="text-xs text-muted-foreground">
                    実績{booked?.actualDays ?? 0}日・予約{booked?.onHandDays ?? 0}日
                  </span>
                )}
              </div>

              <div className="flex flex-col" data-testid="summary-occupancy">
                <p className="mb-0.5 text-xs text-muted-foreground">
                  月間稼働率{hasBookings ? "（実績＋予約）" : ""}
                </p>
                <div className="mb-0.5 text-lg font-semibold">{formatPercent(booked?.cells.occupancy.value ?? summary?.occupancyRate)}</div>
                {toDate?.budgetOccupancyRatio != null && (
                  <span className="text-xs text-muted-foreground">
                    実績の日の対予算 {formatPercent(toDate.budgetOccupancyRatio)}
                  </span>
                )}
                {toDate?.lastYearOccupancyRatio != null && (
                  <span className="text-xs text-muted-foreground">
                    実績の日の対前年 {formatPercent(toDate.lastYearOccupancyRatio)}
                  </span>
                )}
              </div>

              <div className="flex flex-col">
                <p className="mb-0.5 text-xs text-muted-foreground">月間ADR</p>
                <div className="mb-0.5 text-lg font-semibold">{hasActuals ? formatYen(summary?.adr) : "-"}</div>
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
                <p className="mb-0.5 text-xs text-muted-foreground">月間REV-Per</p>
                <div className="mb-0.5 text-lg font-semibold">{hasActuals ? formatYen(summary?.revPar) : "-"}</div>
                <span className="text-xs text-muted-foreground">
                  室料売上 {hasActuals ? formatYen(summary?.roomRevenue) : "-"}
                </span>
              </div>
            </div>
          )}

          {!loading && !performanceLoading && (hasActuals || hasBookings) && (
            <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-3">
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

      {/* 日別パフォーマンス（実数と想定値／差異 — 2026-10） */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">
            日別パフォーマンス（{targetMonthLabel}）
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            過去は実績、先の日は今の予約実数を、AIの想定・日割り予算・予算差異と項目ごとに並べます。「差異で見る」で予算差異・AI想定差異・前年比に切り替えます
            （料金カレンダーの「結果」「想定差異」はここへ移しました）。
            行をクリックすると、下の日のグラフにその日を表示します。日付からダイナミックプライシングの同じ日へ移動できます。
          </p>
        </CardHeader>
        <CardContent className="space-y-6 pt-0">
          {performanceLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : performanceError || !performance ? (
            <ErrorState message={performanceError ?? "日別パフォーマンスの取得に失敗しました"} onRetry={reloadPerformance} />
          ) : performance.days.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{targetMonthLabel}の日別データがありません。</p>
          ) : (
            <>
              <DailyVarianceTable
                days={performance.days}
                totalRooms={performance.totalRooms}
                month={month}
                selectedDate={chartDate}
                onSelectDate={selectChartDate}
                onNavigateToPricing={onNavigateToPricing}
              />
              <VarianceMonthCharts year={year} month={month} />
              <VarianceDayCharts
                date={chartDate}
                year={year}
                month={month}
                onDateChange={selectChartDate}
                onOpenBookingCurve={onOpenBookingCurve}
              />
            </>
          )}
        </CardContent>
      </Card>
    </>
  )
}
