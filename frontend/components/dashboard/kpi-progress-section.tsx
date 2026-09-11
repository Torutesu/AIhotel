"use client"

// KPI進捗状況（U-15 で dashboard-tab.tsx から分割）
// GET /dashboard/kpi の summary / comparison / simulation を表示する。

import { useEffect, useMemo, useState } from "react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { api, type DashboardKpi } from "@/lib/api"
import { formatPercent, formatRatio, formatYen, isRatioNegative as ratioNegative } from "@/lib/format"

/** KPI進捗表に表示できる指標（設定タブで施設ごとに選択する。F-DASH-01） */
export const ALL_KPI_KEYS = [
  "roomRevenue",
  "soldRooms",
  "adr",
  "occupancyRate",
  "revPar",
  "guests",
  "dor",
  "guestUnitPrice",
] as const

// KPI進捗の表示月数（開始月からの相対。F-DASH-01）
const MONTH_SPAN_OPTIONS = [
  { value: "1", label: "1か月" },
  { value: "3", label: "3か月" },
  { value: "6", label: "6か月" },
  { value: "12", label: "12か月" },
]

// 値そのものが提供されないことを示す表示（0 や月次値で埋めない — #54）
const EM_DASH = "—"

// KPI進捗の比較軸（F-DASH-02）
type ComparisonAxisKey = "toDate" | "cumulative" | "fiscalYear"

const COMPARISON_AXES: Array<{ key: ComparisonAxisKey; label: string; description: string }> = [
  { key: "toDate", label: "本日まで", description: "経過日数で按分した予算に対する進捗ペース" },
  { key: "cumulative", label: "累計進捗", description: "月間予算に対する現時点の到達率" },
  { key: "fiscalYear", label: "年度累計", description: "年度開始月から当月までの累計どうしの比較" },
]

interface KpiProgressSectionProps {
  hotelId: string
  kpi: DashboardKpi | null
  loading: boolean
  year: number
  month: number
  /** 設定タブで選択された表示項目 */
  visibleKpiKeys: string[]
}

export function KpiProgressSection({
  hotelId,
  kpi,
  loading,
  year,
  month,
  visibleKpiKeys,
}: KpiProgressSectionProps) {
  // KPI進捗の比較軸（F-DASH-02: 本日まで／累計進捗／年度累計）
  const [comparisonAxis, setComparisonAxis] = useState<ComparisonAxisKey>("toDate")
  // KPI進捗の表示月数（1/3/6/12か月。開始月＝上部で選択中の対象年月）
  const [monthSpan, setMonthSpan] = useState("1")
  // 複数月表示時の各月KPI
  const [spanKpis, setSpanKpis] = useState<DashboardKpi[]>([])
  const [spanLoading, setSpanLoading] = useState(false)

  // 複数月表示（F-DASH-01）: 開始月からNか月ぶんを単月APIの並列取得で組み立てる
  useEffect(() => {
    const span = Number(monthSpan)
    if (!hotelId || span <= 1) {
      setSpanKpis([])
      return
    }
    let cancelled = false
    setSpanLoading(true)
    const targets = Array.from({ length: span }, (_, i) => {
      const offset = month - 1 + i
      return { year: year + Math.floor(offset / 12), month: (offset % 12) + 1 }
    })
    Promise.all(targets.map((t) => api.dashboardKpi(hotelId, t.year, t.month)))
      .then((results) => {
        if (!cancelled) setSpanKpis(results)
      })
      .catch(() => {
        // 単月表示は成功しているため、複数月ぶんの取得失敗時は単月表示にフォールバックする
        if (!cancelled) setSpanKpis([])
      })
      .finally(() => {
        if (!cancelled) setSpanLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [hotelId, year, month, monthSpan])

  const axis = useMemo(() => {
    if (!kpi?.comparison) return null
    return kpi.comparison[comparisonAxis] ?? null
  }, [kpi, comparisonAxis])

  // 選択中の軸の集計日数（年度累計なら年度開始月からの実績日数）
  const axisActualDays = useMemo(
    () => kpi?.comparison?.actualSummary?.[comparisonAxis]?.actualDays ?? null,
    [kpi, comparisonAxis]
  )

  // KPI進捗テーブル用の行（実データのみ。バックエンドが提供しない比較値は「-」表示）
  const kpiRows = useMemo(() => {
    if (!kpi) return []
    const { comparison, simulation } = kpi
    // 選択中の比較軸に対応する実績サマリー（#54）。
    // 年度累計軸で当月実績へフォールバックすると「年度売上 ÷ 販売室数」が
    // 表示中のADRと合わなくなるため、軸の実績が取得できないときは「—」にする。
    const actual = comparison?.actualSummary?.[comparisonAxis] ?? null
    // 実績が1日も登録されていない期間は、実績ゼロではなく「未登録」として扱う（U-11）
    const hasActuals = (actual?.actualDays ?? 0) > 0
    const actualOr = (value: (s: NonNullable<typeof actual>) => string) =>
      actual == null ? EM_DASH : hasActuals ? value(actual) : "未登録"
    // 実績が無い期間は比率も「0.0%」ではなく「-」にする（実績ゼロと誤解させない — U-11）
    const ratioOr = (value: number | null | undefined) =>
      hasActuals && value != null ? formatPercent(value) : "-"
    const ratioNeg = (value: number | null | undefined) =>
      hasActuals && value != null && value < 0.95

    return [
      {
        key: "roomRevenue",
        label: "室料売上",
        actual: actualOr((a) => formatYen(a.roomRevenue)),
        budgetRatio: ratioOr(axis?.budgetRevenueRatio),
        budgetNegative: ratioNeg(axis?.budgetRevenueRatio),
        lastYearRatio: ratioOr(axis?.lastYearRevenueRatio),
        lastYearNegative: ratioNeg(axis?.lastYearRevenueRatio),
        aiPrediction: formatYen(simulation?.projectedRevenue),
        aiBudgetRatio: formatRatio(simulation?.projectedRevenue, comparison?.budgetRevenue),
        aiBudgetNegative: ratioNegative(simulation?.projectedRevenue, comparison?.budgetRevenue),
        aiLastYearRatio: formatRatio(simulation?.projectedRevenue, comparison?.lastYearRevenue),
        aiLastYearNegative: ratioNegative(simulation?.projectedRevenue, comparison?.lastYearRevenue),
      },
      {
        key: "soldRooms",
        label: "販売室数",
        actual: actualOr((a) => `${a.soldRooms.toLocaleString()}室`),
        budgetRatio: "-",
        budgetNegative: false,
        lastYearRatio: "-",
        lastYearNegative: false,
        aiPrediction: "-",
        aiBudgetRatio: "-",
        aiBudgetNegative: false,
        aiLastYearRatio: "-",
        aiLastYearNegative: false,
      },
      {
        key: "adr",
        label: "ADR",
        actual: actualOr((a) => formatYen(a.adr)),
        budgetRatio: ratioOr(axis?.budgetAdrRatio),
        budgetNegative: ratioNeg(axis?.budgetAdrRatio),
        lastYearRatio: ratioOr(axis?.lastYearAdrRatio),
        lastYearNegative: ratioNeg(axis?.lastYearAdrRatio),
        aiPrediction: formatYen(simulation?.projectedAdr),
        aiBudgetRatio: formatRatio(simulation?.projectedAdr, comparison?.budgetAdr),
        aiBudgetNegative: ratioNegative(simulation?.projectedAdr, comparison?.budgetAdr),
        aiLastYearRatio: formatRatio(simulation?.projectedAdr, comparison?.lastYearAdr),
        aiLastYearNegative: ratioNegative(simulation?.projectedAdr, comparison?.lastYearAdr),
      },
      {
        key: "occupancyRate",
        label: "稼働率",
        actual: actualOr((a) => formatPercent(a.occupancyRate)),
        budgetRatio: ratioOr(axis?.budgetOccupancyRatio),
        budgetNegative: ratioNeg(axis?.budgetOccupancyRatio),
        lastYearRatio: ratioOr(axis?.lastYearOccupancyRatio),
        lastYearNegative: ratioNeg(axis?.lastYearOccupancyRatio),
        aiPrediction: formatPercent(simulation?.projectedOccupancy),
        aiBudgetRatio: formatRatio(simulation?.projectedOccupancy, comparison?.budgetOccupancy),
        aiBudgetNegative: ratioNegative(simulation?.projectedOccupancy, comparison?.budgetOccupancy),
        aiLastYearRatio: formatRatio(simulation?.projectedOccupancy, comparison?.lastYearOccupancy),
        aiLastYearNegative: ratioNegative(simulation?.projectedOccupancy, comparison?.lastYearOccupancy),
      },
      {
        key: "revPar",
        label: "REV-Per",
        actual: actualOr((a) => formatYen(a.revPar)),
        budgetRatio: "-",
        budgetNegative: false,
        lastYearRatio: "-",
        lastYearNegative: false,
        aiPrediction: formatYen(simulation?.projectedRevPar),
        aiBudgetRatio: "-",
        aiBudgetNegative: false,
        aiLastYearRatio: "-",
        aiLastYearNegative: false,
      },
      {
        key: "guests",
        label: "宿泊人数",
        actual: actualOr((a) => `${a.guests.toLocaleString()}人`),
        budgetRatio: "-",
        budgetNegative: false,
        lastYearRatio: "-",
        lastYearNegative: false,
        aiPrediction: "-",
        aiBudgetRatio: "-",
        aiBudgetNegative: false,
        aiLastYearRatio: "-",
        aiLastYearNegative: false,
      },
      {
        key: "dor",
        label: "DOR",
        actual: actualOr((a) => `${a.dor.toFixed(2)}人`),
        budgetRatio: "-",
        budgetNegative: false,
        lastYearRatio: "-",
        lastYearNegative: false,
        aiPrediction: "-",
        aiBudgetRatio: "-",
        aiBudgetNegative: false,
        aiLastYearRatio: "-",
        aiLastYearNegative: false,
      },
      {
        key: "guestUnitPrice",
        label: "客単価",
        actual: actualOr((a) => formatYen(a.guestUnitPrice)),
        budgetRatio: "-",
        budgetNegative: false,
        lastYearRatio: "-",
        lastYearNegative: false,
        aiPrediction: "-",
        aiBudgetRatio: "-",
        aiBudgetNegative: false,
        aiLastYearRatio: "-",
        aiLastYearNegative: false,
      },
    ]
  }, [kpi, comparisonAxis, axis])

  // 設定タブで選択された表示項目のみに絞る（F-DASH-01）
  const visibleKpiRows = useMemo(
    () => kpiRows.filter((row) => visibleKpiKeys.includes(row.key)),
    [kpiRows, visibleKpiKeys]
  )

  // 複数月表示（F-DASH-01）: 指標×月のマトリクス。実績値のみを月ごとに並べる
  const multiMonthTable = useMemo(() => {
    if (Number(monthSpan) <= 1 || spanKpis.length === 0) return null

    const columns = spanKpis.map((k) => ({
      key: `${k.year}-${k.month}`,
      label: `${k.year}/${String(k.month).padStart(2, "0")}`,
    }))

    // 実績が1日も無い月は「未登録」を返す（実績ゼロと区別する — U-11）
    const withActuals =
      (format: (k: DashboardKpi) => string) =>
      (k: DashboardKpi): string =>
        k.summary.actualDays > 0 ? format(k) : "未登録"

    const formatters: Record<string, (k: DashboardKpi) => string> = {
      roomRevenue: withActuals((k) => formatYen(k.summary.roomRevenue)),
      soldRooms: withActuals((k) => `${k.summary.soldRooms.toLocaleString()}室`),
      adr: withActuals((k) => formatYen(k.summary.adr)),
      occupancyRate: withActuals((k) => formatPercent(k.summary.occupancyRate)),
      revPar: withActuals((k) => formatYen(k.summary.revPar)),
      guests: withActuals((k) => `${k.summary.guests.toLocaleString()}人`),
      dor: withActuals((k) => `${k.summary.dor.toFixed(2)}人`),
      guestUnitPrice: withActuals((k) => formatYen(k.summary.guestUnitPrice)),
    }

    const labels: Record<string, string> = {
      roomRevenue: "室料売上",
      soldRooms: "販売室数",
      adr: "ADR",
      occupancyRate: "稼働率",
      revPar: "REV-Per",
      guests: "宿泊人数",
      dor: "DOR",
      guestUnitPrice: "客単価",
    }

    const rows = ALL_KPI_KEYS.filter((key) => visibleKpiKeys.includes(key)).map((key) => ({
      key,
      label: labels[key],
      values: spanKpis.map((k) => formatters[key](k)),
    }))

    return { columns, rows }
  }, [monthSpan, spanKpis, visibleKpiKeys])

  // 在庫表（日別・タイプ別残室と比較時点との差分）。日付から決定的に導出するモックデータ

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-heading font-medium tracking-tight">KPI進捗状況</h2>
        <div className="flex items-center gap-3 flex-wrap">
          {/* 開始月は上部の対象年月。ここでは表示月数を選ぶ（F-DASH-01） */}
          <div className="flex items-center gap-1.5">
            <Label htmlFor="kpi-month-span" className="text-xs whitespace-nowrap">
              {year}年{month}月から
            </Label>
            <Select value={monthSpan} onValueChange={setMonthSpan}>
              <SelectTrigger id="kpi-month-span" className="h-7 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTH_SPAN_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            {axisActualDays == null
              ? ""
              : axisActualDays > 0
                ? `${axisActualDays}日分の実績を集計${comparisonAxis === "fiscalYear" ? "（年度累計）" : ""}`
                : "この期間の実績は未登録です（0は実績ゼロではありません）"}
          </p>
        </div>
      </div>

      {/* 比較軸の切り替え（F-DASH-02） */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {COMPARISON_AXES.map((option) => (
            <button
              key={option.key}
              onClick={() => setComparisonAxis(option.key)}
              title={option.description}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                comparisonAxis === option.key
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              {option.key === "fiscalYear" && kpi?.comparison
                ? kpi.comparison.fiscalYearLabel
                : option.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {COMPARISON_AXES.find((o) => o.key === comparisonAxis)?.description}
        </p>
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : kpi ? (
        <Card>
          <CardContent className="p-0 pt-2 pb-2">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-center py-1.5 px-2 font-medium border-r">指標</th>
                    <th className="text-center py-1.5 px-2 font-medium border-r">
                      {comparisonAxis === "fiscalYear" ? "年度累計実績" : "当月実績"}
                    </th>
                    <th className="text-center py-1.5 px-2 font-medium border-r">
                      予算比（{COMPARISON_AXES.find((o) => o.key === comparisonAxis)?.label}）
                    </th>
                    <th className="text-center py-1.5 px-2 font-medium border-r">
                      前年比（{COMPARISON_AXES.find((o) => o.key === comparisonAxis)?.label}）
                    </th>
                    <th className="text-center py-1.5 px-2 font-medium border-r">AI着地予測</th>
                    <th className="text-center py-1.5 px-2 font-medium border-r">対予算(AI)</th>
                    <th className="text-center py-1.5 px-2 font-medium">対前年(AI)</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleKpiRows.map((row) => (
                    <tr key={row.label} className="border-b hover:bg-muted/20">
                      <td className="py-1.5 px-2 font-medium border-r bg-muted/10">{row.label}</td>
                      <td className="text-right py-1.5 px-2 font-semibold border-r">{row.actual}</td>
                      <td className={`text-right py-1.5 px-2 border-r ${row.budgetNegative ? "text-[color:var(--negative)]" : ""}`}>
                        {row.budgetRatio}
                      </td>
                      <td className={`text-right py-1.5 px-2 border-r ${row.lastYearNegative ? "text-[color:var(--negative)]" : ""}`}>
                        {row.lastYearRatio}
                      </td>
                      <td className="text-right py-1.5 px-2 border-r font-semibold text-positive">
                        {row.aiPrediction}
                      </td>
                      <td className={`text-right py-1.5 px-2 border-r ${row.aiBudgetNegative ? "text-[color:var(--negative)]" : ""}`}>
                        {row.aiBudgetRatio}
                      </td>
                      <td className={`text-right py-1.5 px-2 ${row.aiLastYearNegative ? "text-[color:var(--negative)]" : ""}`}>
                        {row.aiLastYearRatio}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">データがありません。</p>
      )}

      {/* 複数月表示（F-DASH-01）: 指標×月の実績マトリクス */}
      {Number(monthSpan) > 1 && (
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium">
              月別実績推移（{year}年{month}月から{monthSpan}か月）
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            {spanLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : multiMonthTable ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-center py-1.5 px-2 font-medium border-r whitespace-nowrap">指標</th>
                      {multiMonthTable.columns.map((col) => (
                        <th
                          key={col.key}
                          className="text-center py-1.5 px-2 font-medium border-r whitespace-nowrap"
                        >
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {multiMonthTable.rows.map((row) => (
                      <tr key={row.key} className="border-b hover:bg-muted/20">
                        <td className="py-1.5 px-2 font-medium border-r bg-muted/10 whitespace-nowrap">
                          {row.label}
                        </td>
                        {row.values.map((value, i) => (
                          <td
                            key={multiMonthTable.columns[i].key}
                            className="text-right py-1.5 px-2 border-r whitespace-nowrap"
                          >
                            {value}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                月別データを取得できませんでした。表示月数を変更して再度お試しください。
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
