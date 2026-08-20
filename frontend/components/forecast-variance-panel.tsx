"use client"

// AI予測とレベニュー担当予測の差異（F-DP-11 / F-DP-12）。
//
// 「AIはこう見ている / 担当者はこう見ている」を同じ土俵で並べ、
//   1. 月次の着地見込みの差
//   2. 日別のどこでどれだけズレているか
//   3. ズレている箇所の意図・背景（乖離が基準を超えた日は記入必須）
//   4. 実績が出た後、どちらの見立てが当たったか（背景別に集計）
// を1枚で見せる。

import { useState, useEffect, useCallback, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertCircle, RefreshCw, Loader2, Pencil, X, Info, Scale } from "lucide-react"
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { toast } from "sonner"

import { useAuth } from "@/components/auth-provider"
import {
  api,
  ApiClientError,
  type ForecastVarianceReport,
  type ForecastVarianceDay,
  type ForecastVarianceReason,
  type OperatorForecastEntryInput,
  type CloserSide,
  type MetricTotals,
} from "@/lib/api"

const REASON_OPTIONS: Array<{ value: ForecastVarianceReason; label: string }> = [
  { value: "BOOKING_PACE", label: "予約の入り方" },
  { value: "COMPETITOR_SUPPLY", label: "競合の供給・価格" },
  { value: "EVENT_LOCAL", label: "地域イベント・催事" },
  { value: "GROUP_CONTRACT", label: "団体・法人契約の確度" },
  { value: "REPEAT_GUEST", label: "常連・リピーター動向" },
  { value: "MARKET_TREND", label: "市況・季節性" },
  { value: "OTA_CAMPAIGN", label: "OTA施策の効き" },
  { value: "RENOVATION_OPS", label: "改装・運営制約" },
  { value: "DATA_DOUBT", label: "AI予測の前提データに疑義" },
  { value: "OTHER", label: "その他" },
]

const REASON_LABELS = Object.fromEntries(REASON_OPTIONS.map((o) => [o.value, o.label])) as Record<
  ForecastVarianceReason,
  string
>

const CLOSER_STYLE: Record<CloserSide, { label: string; className: string }> = {
  OPERATOR: { label: "担当者が的中", className: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  AI: { label: "AIが的中", className: "bg-sky-100 text-sky-700 border-sky-200" },
  TIE: { label: "互角", className: "bg-slate-100 text-slate-600 border-slate-200" },
}

const METRIC_LABELS: Record<string, string> = { occupancy: "稼働率", adr: "ADR", revenue: "売上" }

function pct(value: number | null | undefined, digits = 1): string {
  return value == null ? "—" : `${(value * 100).toFixed(digits)}%`
}

function signedPt(value: number | null | undefined, digits = 1): string {
  if (value == null) return "—"
  const sign = value > 0 ? "+" : value < 0 ? "−" : "±"
  return `${sign}${Math.abs(value * 100).toFixed(digits)}pt`
}

function signedPct(value: number | null | undefined, digits = 1): string {
  if (value == null) return "—"
  const sign = value > 0 ? "+" : value < 0 ? "−" : "±"
  return `${sign}${Math.abs(value * 100).toFixed(digits)}%`
}

function yen(value: number | null | undefined): string {
  return value == null ? "—" : `¥${Math.round(value).toLocaleString()}`
}

function man(value: number | null | undefined): string {
  return value == null ? "—" : `¥${(Math.round(value / 10_000)).toLocaleString()}万`
}

function signedMan(value: number | null | undefined): string {
  if (value == null) return "—"
  const sign = value > 0 ? "+" : value < 0 ? "−" : "±"
  return `${sign}¥${Math.abs(Math.round(value / 10_000)).toLocaleString()}万`
}

function formatDayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  const names = ["日", "月", "火", "水", "木", "金", "土"]
  return `${d.getMonth() + 1}/${d.getDate()}(${names[d.getDay()]})`
}

interface DraftRow {
  occupancy: string
  adr: string
  reason: ForecastVarianceReason | ""
  note: string
}

interface ForecastVariancePanelProps {
  hotelId: string
  year: number
  month: number
}

export function ForecastVariancePanel({ hotelId, year, month }: ForecastVariancePanelProps) {
  const { user } = useAuth()
  const canEdit = user?.role === "ADMIN" || user?.role === "MANAGER"

  const [report, setReport] = useState<ForecastVarianceReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<Record<string, DraftRow>>({})

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setReport(await api.forecastVariance(hotelId, year, month))
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "予測差異データの取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId, year, month])

  useEffect(() => {
    void loadData()
    setEditing(false)
  }, [loadData])

  // 差異が出ている日を大きい順に（担当者予測が入っている日のみ）
  const divergentDays = useMemo(() => {
    if (!report) return []
    return report.days
      .filter((d) => d.operator.occupancy != null && d.variance.occupancyDelta != null)
      .sort((a, b) => Math.abs(b.variance.occupancyDelta ?? 0) - Math.abs(a.variance.occupancyDelta ?? 0))
  }, [report])

  function startEditing() {
    if (!report) return
    const next: Record<string, DraftRow> = {}
    for (const day of report.days) {
      // 既存の担当者予測があればそれを、無ければAI予測を初期値にする
      const base = day.operator.occupancy != null ? day.operator : day.ai
      next[day.date] = {
        occupancy: base.occupancy != null ? String(Math.round(base.occupancy * 1000) / 10) : "",
        adr: base.adr != null ? String(Math.round(base.adr)) : "",
        reason: day.varianceReason ?? "",
        note: day.varianceNote ?? "",
      }
    }
    setDraft(next)
    setEditing(true)
  }

  /** 入力値がAI予測の基準を超えているか（超えていれば意図・背景が必須） */
  function draftBreach(day: ForecastVarianceDay, row: DraftRow | undefined): string[] {
    if (!report || !row) return []
    const occ = row.occupancy === "" ? null : Number(row.occupancy) / 100
    const adr = row.adr === "" ? null : Number(row.adr)
    const breached: string[] = []

    if (occ != null && day.ai.occupancy != null && Number.isFinite(occ)) {
      if (Math.abs(occ - day.ai.occupancy) >= report.thresholds.occupancyPtThreshold) breached.push("occupancy")
    }
    if (adr != null && day.ai.adr != null && day.ai.adr > 0 && Number.isFinite(adr)) {
      if (Math.abs((adr - day.ai.adr) / day.ai.adr) >= report.thresholds.adrPctThreshold) breached.push("adr")
    }
    if (occ != null && adr != null && day.ai.revenue != null && day.ai.revenue > 0 && report.totalRooms > 0) {
      const revenue = Math.round(occ * report.totalRooms) * adr
      if (Math.abs((revenue - day.ai.revenue) / day.ai.revenue) >= report.thresholds.revenuePctThreshold)
        breached.push("revenue")
    }
    return breached
  }

  async function handleSave() {
    if (!report) return

    const entries: OperatorForecastEntryInput[] = []
    const missing: string[] = []

    for (const day of report.days) {
      const row = draft[day.date]
      if (!row) continue
      const occ = row.occupancy === "" ? null : Number(row.occupancy) / 100
      const adr = row.adr === "" ? null : Number(row.adr)
      if (occ == null && adr == null) continue
      if ((occ != null && !Number.isFinite(occ)) || (adr != null && !Number.isFinite(adr))) {
        toast.error(`${formatDayLabel(day.date)}: 数値を正しく入力してください`)
        return
      }

      // 変更が無い日は送らない（改訂履歴が無意味に増えるため）
      const unchanged =
        day.operator.occupancy != null &&
        occ != null &&
        Math.abs(day.operator.occupancy - occ) < 0.0005 &&
        day.operator.adr != null &&
        adr != null &&
        Math.round(day.operator.adr) === Math.round(adr) &&
        (day.varianceReason ?? "") === row.reason &&
        (day.varianceNote ?? "") === row.note
      if (unchanged) continue

      if (draftBreach(day, row).length > 0 && !row.reason) {
        missing.push(formatDayLabel(day.date))
        continue
      }

      entries.push({
        date: day.date,
        ...(occ != null ? { occupancy: Math.round(occ * 10000) / 10000 } : {}),
        ...(adr != null ? { adr: Math.round(adr) } : {}),
        ...(row.reason ? { varianceReason: row.reason } : {}),
        ...(row.note.trim() ? { varianceNote: row.note.trim() } : {}),
      })
    }

    if (missing.length > 0) {
      toast.error(`AI予測との乖離が基準を超えています。意図・背景を選んでください: ${missing.join("、")}`)
      return
    }
    if (entries.length === 0) {
      toast.info("変更された予測がありません")
      return
    }

    setSaving(true)
    try {
      const result = await api.saveOperatorForecasts(hotelId, entries)
      toast.success(`担当者予測を${result.saved}件登録しました`)
      setEditing(false)
      await loadData()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "登録に失敗しました")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">AI予測とレベニュー担当予測の差異</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (error || !report) {
    return (
      <Card>
        <CardContent className="py-8 flex flex-col items-center gap-3 text-center">
          <AlertCircle className="w-8 h-8 text-destructive" />
          <p className="text-sm text-muted-foreground">{error ?? "データがありません"}</p>
          <Button variant="outline" size="sm" onClick={() => void loadData()} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            再試行
          </Button>
        </CardContent>
      </Card>
    )
  }

  const { summary, monthly, thresholds } = report

  return (
    <div className="space-y-4">
      {/* ---- 月次の着地見込み比較 ---- */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Scale className="w-4 h-4" />
              AI予測とレベニュー担当予測の差異
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              同じ宿泊日について、AIの予測と担当者の予測を突き合わせ、ズレている箇所の背景を残します
            </p>
          </div>
          {canEdit &&
            (editing ? (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setEditing(false)} disabled={saving}>
                  <X className="w-4 h-4" />
                  キャンセル
                </Button>
                <Button size="sm" className="gap-1.5" onClick={() => void handleSave()} disabled={saving}>
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  保存
                </Button>
              </div>
            ) : (
              <Button size="sm" className="gap-1.5" onClick={startEditing}>
                <Pencil className="w-4 h-4" />
                担当者予測を入力
              </Button>
            ))}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse min-w-[560px]">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-1.5 px-2 font-medium">月間の着地見込み</th>
                  <th className="text-right py-1.5 px-2 font-medium">稼働率</th>
                  <th className="text-right py-1.5 px-2 font-medium">ADR</th>
                  <th className="text-right py-1.5 px-2 font-medium">販売室数</th>
                  <th className="text-right py-1.5 px-2 font-medium">売上</th>
                </tr>
              </thead>
              <tbody>
                <MonthlyRow label="AI予測" totals={monthly.ai} />
                <MonthlyRow label="レベニュー担当予測" totals={monthly.operator} emphasize />
                <MonthlyRow label="実績（判明分）" totals={monthly.actual} muted />
                <tr className="border-b last:border-0">
                  <td className="py-1.5 px-2 font-medium">差異（担当者 − AI）</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">
                    {monthly.ai.occupancy != null && monthly.operator.occupancy != null
                      ? signedPt(monthly.operator.occupancy - monthly.ai.occupancy)
                      : "—"}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums">
                    {monthly.ai.adr != null && monthly.operator.adr != null
                      ? signedPct((monthly.operator.adr - monthly.ai.adr) / monthly.ai.adr)
                      : "—"}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums">
                    {monthly.ai.soldRooms != null && monthly.operator.soldRooms != null
                      ? `${monthly.operator.soldRooms - monthly.ai.soldRooms > 0 ? "+" : ""}${monthly.operator.soldRooms - monthly.ai.soldRooms}室`
                      : "—"}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums">
                    {monthly.ai.revenue != null && monthly.operator.revenue != null
                      ? signedMan(monthly.operator.revenue - monthly.ai.revenue)
                      : "—"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">
            担当者予測が入っている{monthly.operator.days}日で比較。実績は判明している{monthly.actual.days}日分のみ。
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Tile label="予測を入れた日数" value={`${summary.forecastedDays} / ${summary.totalDays}日`} />
            <Tile
              label="基準超えの乖離"
              value={`${summary.exceededDays}日`}
              hint={`稼働率 ${(thresholds.occupancyPtThreshold * 100).toFixed(0)}pt / ADR ${(thresholds.adrPctThreshold * 100).toFixed(0)}% / 売上 ${(thresholds.revenuePctThreshold * 100).toFixed(0)}% 以上のズレ。この日は意図・背景の記入が必須`}
            />
            <Tile label="背景が記入済み" value={`${summary.explainedDays} / ${summary.exceededDays}日`} />
            <Tile
              label="実績に近かったのは"
              value={
                summary.evaluatedDays > 0
                  ? `担当者 ${pct(summary.operatorCloserRate, 0)} / AI ${pct(summary.aiCloserRate, 0)}`
                  : "評価待ち"
              }
              hint={`実績が判明した ${summary.evaluatedDays}日が母数。売上（無ければ稼働率）の誤差が小さい方を「近い」と判定`}
            />
          </div>
        </CardContent>
      </Card>

      {/* ---- 背景別の分析 ---- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">差異の背景と、その見立ての当たり方</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            「どういう背景でAIと違う数字を見ているか」ごとに、ズレの向きと実績での的中率を集計します
          </p>
        </CardHeader>
        <CardContent>
          {summary.byReason.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              この月は意図・背景が記入された差異がありません。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse min-w-[620px]">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-1.5 px-2 font-medium">背景</th>
                    <th className="text-right py-1.5 px-2 font-medium">日数</th>
                    <th className="text-right py-1.5 px-2 font-medium">稼働率の平均ズレ</th>
                    <th className="text-right py-1.5 px-2 font-medium">ADRの平均ズレ</th>
                    <th className="text-right py-1.5 px-2 font-medium">売上の平均ズレ</th>
                    <th className="text-right py-1.5 px-2 font-medium">担当者の的中率</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byReason.map((row) => (
                    <tr key={row.key} className="border-b last:border-0">
                      <td className="py-1.5 px-2">{REASON_LABELS[row.key]}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{row.count}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{signedPt(row.avgOccupancyDelta)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{signedPct(row.avgAdrDeltaPct)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{signedPct(row.avgRevenueDeltaPct)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        {row.evaluatedCount > 0
                          ? `${pct(row.operatorCloserRate, 0)}（${row.evaluatedCount}日）`
                          : "評価待ち"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- 日別 ---- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">
            {editing ? "担当者予測の入力（日別）" : "日別の予測差異"}
          </CardTitle>
          {editing && (
            <p className="text-xs text-muted-foreground mt-0.5">
              初期値はAI予測です。違う見立ての日だけ書き換えてください。基準を超えた行は背景の選択が必須になります。
            </p>
          )}
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            {editing ? (
              <table className="w-full text-xs border-collapse min-w-[900px]">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-1.5 px-2 font-medium">日付</th>
                    <th className="text-left py-1.5 px-2 font-medium">需要</th>
                    <th className="text-right py-1.5 px-2 font-medium">AI予測</th>
                    <th className="text-right py-1.5 px-2 font-medium">担当者 稼働率(%)</th>
                    <th className="text-right py-1.5 px-2 font-medium">担当者 ADR</th>
                    <th className="text-left py-1.5 px-2 font-medium">差異</th>
                    <th className="text-left py-1.5 px-2 font-medium">背景</th>
                    <th className="text-left py-1.5 px-2 font-medium">メモ</th>
                  </tr>
                </thead>
                <tbody>
                  {report.days.map((day) => {
                    const row = draft[day.date]
                    const breached = draftBreach(day, row)
                    const needsReason = breached.length > 0 && !row?.reason
                    const occ = row && row.occupancy !== "" ? Number(row.occupancy) / 100 : null
                    const adr = row && row.adr !== "" ? Number(row.adr) : null
                    return (
                      <tr key={day.date} className={`border-b last:border-0 ${needsReason ? "bg-destructive/5" : ""}`}>
                        <td className="py-1 px-2 whitespace-nowrap">{formatDayLabel(day.date)}</td>
                        <td className="py-1 px-2">{day.demandLevel ?? "—"}</td>
                        <td className="py-1 px-2 text-right tabular-nums whitespace-nowrap text-muted-foreground">
                          {pct(day.ai.occupancy)} / {yen(day.ai.adr)}
                        </td>
                        <td className="py-1 px-2">
                          <Input
                            type="number"
                            step="0.1"
                            min={0}
                            max={100}
                            className="h-7 text-xs text-right"
                            value={row?.occupancy ?? ""}
                            onChange={(e) =>
                              setDraft((prev) => ({
                                ...prev,
                                [day.date]: { ...(prev[day.date] ?? { occupancy: "", adr: "", reason: "", note: "" }), occupancy: e.target.value },
                              }))
                            }
                          />
                        </td>
                        <td className="py-1 px-2">
                          <Input
                            type="number"
                            step="100"
                            min={0}
                            className="h-7 text-xs text-right"
                            value={row?.adr ?? ""}
                            onChange={(e) =>
                              setDraft((prev) => ({
                                ...prev,
                                [day.date]: { ...(prev[day.date] ?? { occupancy: "", adr: "", reason: "", note: "" }), adr: e.target.value },
                              }))
                            }
                          />
                        </td>
                        <td className="py-1 px-2 whitespace-nowrap tabular-nums">
                          {occ != null && day.ai.occupancy != null ? signedPt(occ - day.ai.occupancy) : "—"}
                          {" / "}
                          {adr != null && day.ai.adr ? signedPct((adr - day.ai.adr) / day.ai.adr) : "—"}
                          {breached.length > 0 && (
                            <Badge variant="outline" className="ml-1 text-[10px] px-1 border-amber-300 text-amber-700 bg-amber-50">
                              基準超え: {breached.map((b) => METRIC_LABELS[b]).join("・")}
                            </Badge>
                          )}
                        </td>
                        <td className="py-1 px-2 min-w-[170px]">
                          <Select
                            value={row?.reason || "NONE"}
                            onValueChange={(v) =>
                              setDraft((prev) => ({
                                ...prev,
                                [day.date]: {
                                  ...(prev[day.date] ?? { occupancy: "", adr: "", reason: "", note: "" }),
                                  reason: v === "NONE" ? "" : (v as ForecastVarianceReason),
                                },
                              }))
                            }
                          >
                            <SelectTrigger className={`h-7 text-xs ${needsReason ? "border-destructive" : ""}`}>
                              <SelectValue placeholder="選択" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="NONE">—</SelectItem>
                              {REASON_OPTIONS.map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                  {o.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="py-1 px-2 min-w-[200px]">
                          <Input
                            className="h-7 text-xs"
                            placeholder={breached.length > 0 ? "なぜそう見ているか" : "任意"}
                            value={row?.note ?? ""}
                            onChange={(e) =>
                              setDraft((prev) => ({
                                ...prev,
                                [day.date]: { ...(prev[day.date] ?? { occupancy: "", adr: "", reason: "", note: "" }), note: e.target.value },
                              }))
                            }
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            ) : divergentDays.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                この月はまだ担当者予測が入っていません。
              </p>
            ) : (
              <table className="w-full text-xs border-collapse min-w-[900px]">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-1.5 px-2 font-medium">日付</th>
                    <th className="text-left py-1.5 px-2 font-medium">需要</th>
                    <th className="text-right py-1.5 px-2 font-medium">AI予測</th>
                    <th className="text-right py-1.5 px-2 font-medium">担当者予測</th>
                    <th className="text-right py-1.5 px-2 font-medium">差異</th>
                    <th className="text-left py-1.5 px-2 font-medium">意図・背景</th>
                    <th className="text-right py-1.5 px-2 font-medium">実績</th>
                    <th className="text-left py-1.5 px-2 font-medium">的中</th>
                  </tr>
                </thead>
                <tbody>
                  {divergentDays.map((day) => (
                    <DayRow key={day.date} day={day} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function MonthlyRow({
  label,
  totals,
  emphasize,
  muted,
}: {
  label: string
  totals: MetricTotals
  emphasize?: boolean
  muted?: boolean
}) {
  return (
    <tr className={`border-b last:border-0 ${muted ? "text-muted-foreground" : ""}`}>
      <td className={`py-1.5 px-2 ${emphasize ? "font-medium" : ""}`}>{label}</td>
      <td className="py-1.5 px-2 text-right tabular-nums">{pct(totals.occupancy)}</td>
      <td className="py-1.5 px-2 text-right tabular-nums">{yen(totals.adr)}</td>
      <td className="py-1.5 px-2 text-right tabular-nums">{totals.soldRooms != null ? `${totals.soldRooms.toLocaleString()}室` : "—"}</td>
      <td className="py-1.5 px-2 text-right tabular-nums">{man(totals.revenue)}</td>
    </tr>
  )
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border p-2">
      <p className="text-[11px] text-muted-foreground flex items-center gap-1">
        {label}
        {hint && (
          <TooltipProvider>
            <UITooltip>
              <TooltipTrigger>
                <Info className="w-3 h-3" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">{hint}</TooltipContent>
            </UITooltip>
          </TooltipProvider>
        )}
      </p>
      <p className="text-base font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function DayRow({ day }: { day: ForecastVarianceDay }) {
  const closer = day.accuracy.overall ? CLOSER_STYLE[day.accuracy.overall] : null

  return (
    <tr className="border-b last:border-0 align-top">
      <td className="py-1.5 px-2 whitespace-nowrap">
        {formatDayLabel(day.date)}
        {day.dayType === "weekend" && <span className="ml-1 text-[10px] text-muted-foreground">週末</span>}
      </td>
      <td className="py-1.5 px-2">{day.demandLevel ?? "—"}</td>
      <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">
        {pct(day.ai.occupancy)} / {yen(day.ai.adr)}
      </td>
      <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">
        {pct(day.operator.occupancy)} / {yen(day.operator.adr)}
        {day.revisionCount > 0 && (
          <span className="block text-[10px] text-muted-foreground">改訂 {day.revisionCount}回</span>
        )}
      </td>
      <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">
        <span className="font-medium">{signedPt(day.variance.occupancyDelta)}</span>
        <span className="text-muted-foreground"> / {signedPct(day.variance.adrDeltaPct)}</span>
        {day.exceededThreshold && (
          <span className="block text-[10px] text-amber-700">
            基準超え: {day.breachedMetrics.map((b) => METRIC_LABELS[b]).join("・")}
          </span>
        )}
      </td>
      <td className="py-1.5 px-2 max-w-[18rem]">
        {day.varianceReason ? (
          <div className="flex flex-col gap-0.5">
            <Badge variant="outline" className="text-[10px] px-1.5 w-fit">
              {REASON_LABELS[day.varianceReason]}
            </Badge>
            {day.varianceNote && <span className="text-muted-foreground">{day.varianceNote}</span>}
            {day.forecastedByName && (
              <span className="text-[10px] text-muted-foreground">記入: {day.forecastedByName}</span>
            )}
          </div>
        ) : day.exceededThreshold ? (
          <span className="text-destructive text-[11px]">未記入</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="py-1.5 px-2 text-right tabular-nums whitespace-nowrap">
        {day.actual.occupancy == null ? (
          <span className="text-muted-foreground">実績待ち</span>
        ) : (
          <>
            {pct(day.actual.occupancy)} / {yen(day.actual.adr)}
          </>
        )}
      </td>
      <td className="py-1.5 px-2">
        {closer ? (
          <Badge variant="outline" className={`text-[10px] px-1.5 ${closer.className}`}>
            {closer.label}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
    </tr>
  )
}
