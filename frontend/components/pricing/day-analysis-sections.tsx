"use client"

// 日のAI分析の各セクション（2026-10 の画面修正 PDF b01・b03、xlsx DP03）。
//   - 日のタイプと優先モデル（今の型・推移・同じ区分の型の一覧）
//   - 日のブッキングカーブと ADR 推移（合計／タイプ別／利用人数別。初期値は合計）
//   - 同じタイプの日（参考に5日）
//   - 日単位のシミュレーション（優先モデル・料金ランクを変えたときの見込み。保存しない）
// 並べ方・文章を決める部分は純関数にしてテストで固定する。

import { useMemo, useState } from "react"
import { ArrowRight } from "lucide-react"
import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import {
  DAY_MODEL_DESCRIPTIONS,
  DAY_MODEL_LABELS,
  DayModelBadge,
  DayTypeBadge,
  DayTypeHelp,
  dayTypeLetter,
  describeDayType,
  leadLabel,
} from "@/components/pricing/day-type"
import { useApiQuery } from "@/hooks/use-api-query"
import { DAY_NAMES, parseDateStr } from "@/lib/date"
import { formatPercent as pct, formatRooms, formatYen as yen } from "@/lib/format"
import type { ChartTooltipEntry, ChartTooltipProps } from "@/lib/chart-tooltip"
import { api, type BookingCurve, type DayInsight, type DayModel, type DaySimulation, type DaySimulationOption, type PriceRank } from "@/lib/api"

const shortDate = (date: string) => {
  const d = parseDateStr(date)
  return `${d.getMonth() + 1}/${d.getDate()}（${DAY_NAMES[d.getDay()]}）`
}

// ---- 日のタイプと優先モデル ----

export function DayTypeSection({ insight, isPast }: { insight: DayInsight; isPast: boolean }) {
  const current = insight.dayType
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">
          <DayTypeHelp label="日のタイプと優先モデル" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {current ? (
          <div className="flex flex-wrap items-center gap-3">
            <DayTypeBadge dayType={current.name} model={current.model} typicalOccupancy={current.typicalOccupancy} size="lg" />
            <div className="text-sm">
              <p className="font-medium">{describeDayType(current.name, current.model, current.typicalOccupancy)}</p>
              <p className="text-xs text-muted-foreground">
                AI が割り当てた優先モデル: <DayModelBadge model={current.model} className="ml-0.5" />（{DAY_MODEL_DESCRIPTIONS[current.model]}）。
                {isPast ? "結果で決めた型です。" : "予約の入り方が変わると型と優先モデルも変わります。"}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">過去の実績が足りないため、この日の区分（{insight.category}）の型を作れていません。</p>
        )}

        {insight.history.length > 0 && (
          <ol className="flex flex-wrap items-center gap-1.5 text-xs" aria-label="日のタイプの推移">
            {insight.history.map((h) => (
              <li key={h.daysBefore} className="flex items-center gap-1.5">
                <span className="flex flex-col items-center rounded-md border px-2 py-1">
                  <span className="text-[10px] text-muted-foreground">{leadLabel(h.daysBefore)}</span>
                  <DayTypeBadge dayType={h.dayType} />
                </span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden />
              </li>
            ))}
            <li className="flex flex-col items-center rounded-md border border-primary/50 bg-primary/5 px-2 py-1">
              <span className="text-[10px] text-primary">{isPast ? "結果" : "現在"}</span>
              <DayTypeBadge dayType={current?.name} />
            </li>
          </ol>
        )}
        {insight.history.length === 0 && !isPast && (
          <p className="text-xs text-muted-foreground">90日前より後に予約の記録が始まった日のため、推移はまだありません。</p>
        )}

        {insight.categoryTypes.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium">AI が作った{insight.category}の型（過去の結果から。型の数はデータで決まります）</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="px-2 py-1 text-left font-normal">型</th>
                    <th className="px-2 py-1 text-right font-normal">平均稼働</th>
                    <th className="px-2 py-1 text-right font-normal">平均ADR</th>
                    <th className="px-2 py-1 text-right font-normal">日数</th>
                    <th className="px-2 py-1 text-left font-normal">優先モデル</th>
                  </tr>
                </thead>
                <tbody>
                  {insight.categoryTypes.map((t) => (
                    <tr key={t.name} className={t.name === current?.name ? "bg-primary/5" : undefined}>
                      <td className="px-2 py-1">
                        <DayTypeBadge dayType={t.name} model={t.model} typicalOccupancy={t.avgOccupancy} />
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{pct(t.avgOccupancy)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{yen(t.avgAdr)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{t.days}日</td>
                      <td className="px-2 py-1">{DAY_MODEL_LABELS[t.model]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">「-」は、その時点の予約の記録（毎日の取り込み）が無い残日数です。</p>
      </CardContent>
    </Card>
  )
}

// ---- 日のブッキングカーブと ADR 推移 ----

export type CurveView = "total" | "roomType" | "guests"
export const CURVE_VIEW_LABELS: Record<CurveView, string> = { total: "合計", roomType: "タイプ別", guests: "利用人数別" }

export interface DayCurveRow {
  daysBefore: number
  [key: string]: number | null
}

export interface DayCurveSeries {
  key: string
  label: string
  axis: "rooms" | "yen"
  dashed?: boolean
}

/**
 * グラフの行（残日数ごと）と系列を作る。合計 = 予約室数・型の典型・前年同曜日・予約のADR、
 * タイプ別・利用人数別 = 内訳ごとの予約室数と ADR（予約明細が無ければ系列は空）
 */
export function buildDayCurveRows(
  view: CurveView,
  curve: BookingCurve | null,
  insight: DayInsight | null,
): { rows: DayCurveRow[]; series: DayCurveSeries[] } {
  const rows = new Map<number, DayCurveRow>()
  const put = (daysBefore: number, key: string, value: number | null) => {
    const row = rows.get(daysBefore) ?? { daysBefore }
    row[key] = value
    rows.set(daysBefore, row)
  }
  const series: DayCurveSeries[] = []
  if (view === "total") {
    if (curve) {
      for (const p of curve.points) put(p.daysBefore, "rooms", p.roomsBooked)
      if (curve.actual?.soldRooms != null) put(0, "rooms", curve.actual.soldRooms)
      series.push({ key: "rooms", label: "予約室数", axis: "rooms" })
      if (curve.reference?.points.length) {
        for (const p of curve.reference.points) put(p.daysBefore, "lastYear", p.roomsBooked)
        series.push({ key: "lastYear", label: "前年同曜日", axis: "rooms", dashed: true })
      }
      if (curve.adrHistory?.some((a) => a.adr != null)) {
        for (const a of curve.adrHistory) put(a.daysBefore, "adr", a.adr)
        series.push({ key: "adr", label: "予約のADR", axis: "yen" })
      }
    }
    if (insight?.typeProfile?.referenceCurve.length) {
      for (const p of insight.typeProfile.referenceCurve) put(p.daysBefore, "typical", p.roomsBooked)
      series.push({ key: "typical", label: `型の典型（${insight.typeProfile.name}）`, axis: "rooms", dashed: true })
    }
  } else {
    const list = curve?.breakdowns?.[view] ?? []
    list.forEach((s, i) => {
      for (const p of s.points) {
        put(p.daysBefore, `rooms${i}`, p.roomsBooked)
        put(p.daysBefore, `adr${i}`, p.adr)
      }
      series.push({ key: `rooms${i}`, label: s.label, axis: "rooms" })
      if (s.points.some((p) => p.adr != null)) series.push({ key: `adr${i}`, label: `${s.label} ADR`, axis: "yen", dashed: true })
    })
  }
  return { rows: [...rows.values()].sort((a, b) => b.daysBefore - a.daysBefore), series }
}

const SERIES_COLORS = ["var(--positive)", "var(--chart-2)", "var(--chart-4)", "#f19a9a", "var(--negative)", "var(--chart-5)"]

function CurveTooltip({ active, payload }: ChartTooltipProps) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload as DayCurveRow
  return (
    <div className="rounded-lg border bg-background p-2 text-xs shadow-lg">
      <p className="mb-1 font-medium">{row.daysBefore === 0 ? "当日" : `${row.daysBefore}日前`}</p>
      {payload.map((entry: ChartTooltipEntry, i: number) => {
        const name = String(entry.name ?? "")
        const value = entry.value == null ? null : Number(entry.value)
        return (
          <p key={i} className="flex items-center gap-2">
            <span className="h-0.5 w-3" style={{ backgroundColor: entry.color }} />
            {name}: {name.includes("ADR") ? yen(value) : formatRooms(value)}
          </p>
        )
      })}
    </div>
  )
}

export function DayCurveSection({ date, insight }: { date: string; insight: DayInsight | null }) {
  const { hotelId } = useAuth()
  const [view, setView] = useState<CurveView>("total")
  const { data: curve, loading, error, reload } = useApiQuery<BookingCurve>(
    hotelId ? () => api.bookingCurve(hotelId, date) : null,
    [hotelId, date],
    "この日のブッキングカーブの取得に失敗しました",
  )
  const { rows, series } = useMemo(() => buildDayCurveRows(view, curve, insight), [view, curve, insight])
  const hasYen = series.some((s) => s.axis === "yen")
  const breakdownMissing = view !== "total" && series.length === 0

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base font-medium">この日のブッキングカーブ・ADR推移</CardTitle>
          <div className="flex items-center gap-1.5">
            <Label htmlFor="day-curve-view" className="text-xs">
              種類
            </Label>
            <Select value={view} onValueChange={(v) => setView(v as CurveView)}>
              <SelectTrigger id="day-curve-view" className="h-8 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CURVE_VIEW_LABELS) as CurveView[]).map((v) => (
                  <SelectItem key={v} value={v}>
                    {CURVE_VIEW_LABELS[v]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <Skeleton className="h-[240px] w-full" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : breakdownMissing ? (
          <p className="py-10 text-center text-xs text-muted-foreground">
            {CURVE_VIEW_LABELS[view]}の予約の積み上がりと ADR は、予約明細（PMS 連携）の取り込み後に表示します。
          </p>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-xs text-muted-foreground">この日の予約の記録（OTB の取り込み）がありません。</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={rows} margin={{ top: 6, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
              <XAxis
                dataKey="daysBefore"
                type="number"
                reversed
                domain={[0, "dataMax"]}
                tickFormatter={(v) => (v === 0 ? "当日" : `${v}日前`)}
                tick={{ fontSize: 10 }}
                stroke="currentColor"
                opacity={0.5}
              />
              <YAxis yAxisId="rooms" tick={{ fontSize: 10 }} stroke="currentColor" opacity={0.5} width={40} />
              {hasYen && (
                <YAxis
                  yAxisId="yen"
                  orientation="right"
                  tick={{ fontSize: 10 }}
                  stroke="currentColor"
                  opacity={0.5}
                  width={64}
                  tickFormatter={(v) => `¥${Number(v).toLocaleString()}`}
                />
              )}
              <Tooltip content={<CurveTooltip />} />
              <Legend wrapperStyle={{ fontSize: "11px" }} />
              {series.map((s, i) => (
                <Line
                  key={s.key}
                  yAxisId={s.axis}
                  type="linear"
                  dataKey={s.key}
                  name={s.label}
                  stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                  strokeWidth={s.key === "rooms" ? 2.5 : 1.5}
                  strokeDasharray={s.dashed ? "5 3" : undefined}
                  dot={false}
                  connectNulls
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        )}
        <p className="text-[11px] text-muted-foreground">
          左軸: 室数／右軸: 円。初期値は「合計」です。
          {view === "total" && !series.some((s) => s.key === "adr") && "予約のADRの推移は PMS 連携後に表示します。"}
        </p>
      </CardContent>
    </Card>
  )
}

// ---- 同じタイプの日 ----

export function SimilarDaysSection({ insight }: { insight: DayInsight }) {
  const type = insight.dayType?.name
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">同じタイプの日（参考）</CardTitle>
        <p className="text-xs text-muted-foreground">
          {type ? `「${type}」の日を、日付の近い順に5日まで並べます（前後60日）。結果の出た日は実績、先の日は AI の予測です。` : "型を作れていないため表示できません。"}
        </p>
      </CardHeader>
      <CardContent>
        {insight.similarDays.length === 0 ? (
          type && <p className="text-xs text-muted-foreground">前後60日に同じタイプの日がありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="grid min-w-fit grid-flow-col auto-cols-[112px] gap-3">
              {insight.similarDays.map((d) => (
                <div key={d.date} data-testid="similar-day" className="rounded-lg border p-3 text-center">
                  <div className="text-sm font-semibold">{shortDate(d.date)}</div>
                  <div className="my-1">
                    <DayTypeBadge dayType={d.dayType} />
                  </div>
                  <Badge variant={d.isActual ? "secondary" : "outline"} className="mb-1 text-[10px]">
                    {d.isActual ? "結果" : "予測"}
                  </Badge>
                  <div className="text-xs text-muted-foreground">稼働 {pct(d.occupancy)}</div>
                  <div className="text-xs text-muted-foreground">ADR {yen(d.adr)}</div>
                  {!d.isActual && d.recommendedPrice != null && (
                    <div className="text-[11px] text-muted-foreground">推奨 {yen(d.recommendedPrice)}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---- 日単位のシミュレーション ----

const optionLabel = (o: DaySimulationOption) => (o.model === "manual" ? `ランク指定（R${o.rank}）` : DAY_MODEL_LABELS[o.model as DayModel])

export function DaySimulationSection({ date, ranks }: { date: string; ranks: PriceRank[] }) {
  const { hotelId } = useAuth()
  const [rank, setRank] = useState<number | null>(null)
  const { data, loading, error, reload } = useApiQuery<DaySimulation>(
    hotelId ? () => api.daySimulation(hotelId, date, rank ?? undefined) : null,
    [hotelId, date, rank],
    "シミュレーションの取得に失敗しました",
  )
  const rows: Array<{ label: string; option: DaySimulationOption | DaySimulation["base"]; current?: boolean; key: string }> = data
    ? [
        { key: "base", label: `AI の推奨${data.aiModel ? `（${DAY_MODEL_LABELS[data.aiModel]}）` : ""}`, option: data.base, current: true },
        ...data.options.map((o) => ({ key: o.model, label: optionLabel(o), option: o })),
        ...(data.manual ? [{ key: "manual", label: optionLabel(data.manual), option: data.manual }] : []),
      ]
    : []

  return (
    <Card data-testid="day-simulation">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base font-medium">この日のシミュレーション</CardTitle>
          <div className="flex items-center gap-1.5">
            <Label htmlFor="day-sim-rank" className="text-xs">
              ランクを指定して試算
            </Label>
            <Select value={rank == null ? "" : String(rank)} onValueChange={(v) => setRank(Number(v))} disabled={ranks.length === 0}>
              <SelectTrigger id="day-sim-rank" className="h-8 w-40 text-xs">
                <SelectValue placeholder={ranks.length === 0 ? "料金ランク未登録" : "ランクを選択"} />
              </SelectTrigger>
              <SelectContent>
                {ranks.map((r) => (
                  <SelectItem key={r.rank} value={String(r.rank)}>
                    {r.label}（{yen(r.price1P)}）
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          優先モデル（稼働優先・バランス・単価優先）や料金ランクを変えたときの見込みです。保存はしません（推奨は変わりません）。
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && !data ? (
          <Skeleton className="h-[160px] w-full" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : data ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="px-2 py-1.5 text-left font-normal">試算</th>
                    <th className="px-2 py-1.5 text-right font-normal">ランク</th>
                    <th className="px-2 py-1.5 text-right font-normal">ADR</th>
                    <th className="px-2 py-1.5 text-right font-normal">稼働</th>
                    <th className="px-2 py-1.5 text-right font-normal">室数</th>
                    <th className="px-2 py-1.5 text-right font-normal">室料売上</th>
                    <th className="px-2 py-1.5 text-right font-normal">REV-Per</th>
                    <th className="px-2 py-1.5 text-left font-normal">重み（稼働/ADR/競合）</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ key, label, option, current }) => {
                    const weights = "weights" in option ? option.weights : null
                    const isAiModel = "isCurrent" in option && option.isCurrent
                    return (
                      <tr key={key} className={current ? "bg-primary/5 font-medium" : "border-t"}>
                        <td className="px-2 py-1.5">
                          {label}
                          {isAiModel && <span className="ml-1 text-[10px] text-primary">← AI が今使っているモデル</span>}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{option.rank != null ? `R${option.rank}` : "-"}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{yen(option.adr)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{pct(option.occupancy)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{formatRooms(option.rooms)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{yen(option.revenue)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{yen(option.revPar)}</td>
                        <td className="px-2 py-1.5 tabular-nums text-muted-foreground">
                          {weights ? `${weights.occupancy}/${weights.adr}/${weights.competitor}%` : "-"}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              稼働の見込みは、AI の推奨からの単価の差に価格弾力性 {data.elasticity.toFixed(1)}（価格を1%上げると予約が{data.elasticity.toFixed(1)}%減る想定）をかけて出します。
              {data.otbRooms != null && `今の予約 ${data.otbRooms.toLocaleString()}室は下回りません。`}
              価格弾力性と重みの初期値は設定画面の「価格戦略の初期値」で変えられます。
            </p>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

// ---- AI インサイト ----

export interface DayInsightItem {
  type: "positive" | "negative" | "info"
  title: string
  content: string
}

const IMPACT_LABELS: Record<string, string> = { high: "影響度 高", medium: "影響度 中", low: "影響度 低" }

/** この日だけの外部要因（イベント・天候）を項目別に（PDF b03 (2)） */
export function buildExternalFactors(insight: DayInsight | null): Array<{ label: string; items: string[] }> {
  const events = insight?.events ?? []
  return [
    {
      label: "イベント",
      items:
        events.length > 0
          ? events.map((e) => [e.name, e.location, e.expectedImpact ? IMPACT_LABELS[e.expectedImpact] : null, e.excludeFromHistory ? "特殊日" : null].filter(Boolean).join("・"))
          : ["登録されたイベントはありません（外部需要動向で登録できます）"],
    },
    { label: "天候（台風・豪雨・大雪など）", items: ["天候データは未連携です（外部データの取り込み後に表示します）"] },
  ]
}

/** 日のタイプ・優先モデルの見立て（推移で型が変わったか） */
export function buildDayTypeInsights(insight: DayInsight | null): DayInsightItem[] {
  const current = insight?.dayType
  if (!insight || !current) return []
  const items: DayInsightItem[] = [
    {
      type: "info",
      title: `この日は「${current.name}」・${DAY_MODEL_LABELS[current.model]}`,
      content: `${describeDayType(current.name, current.model, current.typicalOccupancy)}。AI は「${DAY_MODEL_LABELS[current.model]}」で推奨価格を決めています（${DAY_MODEL_DESCRIPTIONS[current.model]}）。`,
    },
  ]
  const oldest = insight.history.find((h) => h.dayType != null)
  if (oldest?.dayType && oldest.dayType !== current.name) {
    const before = dayTypeLetter(oldest.dayType) ?? ""
    const now = dayTypeLetter(current.name) ?? ""
    const stronger = now < before
    items.push({
      type: stronger ? "positive" : "negative",
      title: stronger ? "予約が想定より強く入り、型が上がりました" : "予約の入りが弱く、型が下がりました",
      content: `${leadLabel(oldest.daysBefore)}は「${oldest.dayType}」でしたが、今は「${current.name}」です。${
        stronger ? "単価を上げる余地がないか確認してください。" : "価格の幅の上限を下げる・販促を行うなどの手当てを検討してください。"
      }`,
    })
  }
  return items
}
