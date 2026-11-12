"use client"

// 月別需要指数（D-13 — GET /external-signals/demand-index。実データ）。
// 指数 = 季節（前年同月の稼働 ÷ 直近1年の平均稼働 × 100）＋ イベント ＋ 市場の動き。100 = 直近1年の平均。
// 先方の指摘（2026-11）により、グラフの下に月名・季節のチップを並べず、季節カレンダーのカードも作らない。
// 月の季節・イベント・市場の動きは、ツールチップと月ごとの詳細（開閉できる一覧）で見せる。

import { TrendingUp } from "lucide-react"
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { EventSourceBadge } from "@/components/external-demand/event-source-badge"
import { formatEventRange, impactLabel } from "@/components/pricing/pricing-constants"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, type DemandIndex } from "@/lib/api"
import type { ChartTooltipProps } from "@/lib/chart-tooltip"

type DemandMonth = DemandIndex["months"][number]

const SIGNAL_KIND_LABELS: Record<string, string> = {
  inbound: "インバウンド",
  access: "アクセス",
  nature: "季節の見どころ",
  climate: "気候",
  disaster: "災害",
  other: "その他",
}
const DIRECTION_LABELS: Record<string, string> = { up: "上向き", down: "下向き", neutral: "横ばい" }
const MAGNITUDE_LABELS: Record<string, string> = { high: "大", medium: "中", low: "小" }

export const monthTitle = (m: Pick<DemandMonth, "year" | "month">) => `${m.year}年${m.month}月`

const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(1)}`

/** 指数の内訳を一文にする（季節が算出できない月は「平均（100）とみなす」） */
export function componentsSummary(m: DemandMonth): string {
  const seasonal = m.components.seasonal == null ? "季節 100（前年の実績が足りないため平均とみなす）" : `季節 ${m.components.seasonal.toFixed(1)}`
  return `${seasonal}・イベント ${signed(m.components.events)}・市場の動き ${signed(m.components.market)}`
}

export function signalLabel(s: DemandMonth["signals"][number]): string {
  return `${SIGNAL_KIND_LABELS[s.kind] ?? s.kind}: ${s.title}（${DIRECTION_LABELS[s.direction] ?? s.direction}・影響 ${MAGNITUDE_LABELS[s.magnitude] ?? s.magnitude}）`
}

interface ChartRow {
  key: string
  label: string
  index: number
  month: DemandMonth
}

function DemandIndexTooltip({ active, payload }: ChartTooltipProps) {
  const row = active && payload?.length ? (payload[0].payload as ChartRow | undefined) : undefined
  if (!row) return null
  const m = row.month
  return (
    <div className="max-w-[280px] rounded-lg border border-border bg-background p-3 text-xs shadow-lg">
      <p className="mb-1 text-sm font-medium">
        {monthTitle(m)}　指数 <span className="tabular-nums">{m.index.toFixed(1)}</span>
      </p>
      <p className="text-muted-foreground">{componentsSummary(m)}</p>
      {m.seasons.length > 0 && <p className="mt-1">季節: {m.seasons.join("・")}</p>}
      {m.events.length > 0 && <p className="mt-1">イベント: {m.events.map((e) => e.name).join("、")}</p>}
      {m.signals.length > 0 && <p className="mt-1">市場の動き: {m.signals.map((s) => s.title).join("、")}</p>}
    </div>
  )
}

/** 月ごとの詳細（開閉できる一覧）。季節・イベント・市場の動きをここにまとめる */
export function DemandIndexMonthList({ months }: { months: DemandMonth[] }) {
  return (
    <ul className="divide-y rounded-md border" aria-label="月ごとの内訳">
      {months.map((m) => (
        <li key={`${m.year}-${m.month}`}>
          <details className="group px-3 py-2">
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium">{monthTitle(m)}</span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="tabular-nums text-sm font-semibold text-foreground">{m.index.toFixed(1)}</span>
                <span className="group-open:hidden">内訳を見る</span>
                <span className="hidden group-open:inline">閉じる</span>
              </span>
            </summary>
            <div className="mt-2 space-y-1.5 text-xs">
              <p className="text-muted-foreground">{componentsSummary(m)}</p>
              <p>
                <span className="text-muted-foreground">季節：</span>
                {m.seasons.length > 0 ? m.seasons.join("・") : "なし"}
              </p>
              <div>
                <span className="text-muted-foreground">イベント：</span>
                {m.events.length === 0 ? (
                  "なし"
                ) : (
                  <ul className="mt-0.5 space-y-0.5 pl-3">
                    {m.events.map((e) => (
                      <li key={`${e.name}-${e.startDate}`} className="flex flex-wrap items-center gap-1.5">
                        <span>{e.name}</span>
                        <span className="tabular-nums text-muted-foreground">{formatEventRange(e.startDate, e.endDate)}</span>
                        {e.expectedImpact && <span className="text-muted-foreground">{impactLabel(e.expectedImpact)}</span>}
                        <EventSourceBadge event={{ name: e.name, source: e.source === "agent" ? "agent" : "manual", sourceUrl: null }} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">市場の動き：</span>
                {m.signals.length === 0 ? (
                  "なし"
                ) : (
                  <ul className="mt-0.5 space-y-0.5 pl-3">
                    {m.signals.map((s) => (
                      <li key={`${s.kind}-${s.title}`}>{signalLabel(s)}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </details>
        </li>
      ))}
    </ul>
  )
}

export function DemandIndexSection({ months = 6 }: { months?: number }) {
  const { hotelId } = useAuth()
  const { data, loading, error, reload } = useApiQuery<DemandIndex>(
    hotelId ? () => api.demandIndex(hotelId, months) : null,
    [hotelId, months],
    "月別需要指数の取得に失敗しました",
  )
  const rows: ChartRow[] = (data?.months ?? []).map((m) => ({
    key: `${m.year}-${m.month}`,
    label: `${m.month}月`,
    index: m.index,
    month: m,
  }))
  const max = Math.max(120, ...rows.map((r) => Math.ceil(r.index / 10) * 10 + 10))

  return (
    <Card data-testid="demand-index-section">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <TrendingUp className="h-5 w-5" aria-hidden />
          月別需要指数
          <Badge variant="outline" className="text-[10px] font-normal">
            登録データ
          </Badge>
        </CardTitle>
        <CardDescription>今月から{months}か月の需要の見立てです（100 が直近1年の平均）。棒にカーソルを合わせると内訳が出ます。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Skeleton className="h-[260px] w-full" />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : data && rows.length > 0 ? (
          <>
            <div className="h-[260px] w-full" role="img" aria-label="月別需要指数のグラフ（詳細は下の月ごとの内訳）">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} margin={{ top: 16, right: 24, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.5} />
                  <YAxis domain={[0, max]} tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.5} width={36} />
                  <Tooltip content={<DemandIndexTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
                  <ReferenceLine
                    y={100}
                    stroke="var(--muted-foreground)"
                    strokeDasharray="5 5"
                    label={{ value: "平均（100）", position: "right", fontSize: 10 }}
                  />
                  <Bar dataKey="index" name="需要指数" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <DemandIndexMonthList months={data.months} />
            <p className="text-xs text-muted-foreground">{data.basis}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">表示できる月がありません。</p>
        )}
      </CardContent>
    </Card>
  )
}
