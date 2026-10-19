"use client"

// OCC・ADR月間BCグラフ（ブッキングカーブ — 2026-10 の画面修正 DB01）。
// 対象月の宿泊日を1日選び、予約日（横軸）ごとの予約室数の積み上がりを、前年同曜日の参考カーブ・客室数・予算ADRと並べる。
// 左軸 = 室数、右軸 = 円。実データ: GET /daily/booking-curve。
// ADR の推移・販売価格の履歴（HR）・団体（GROUP）は PMS・サイトコントローラー連携（Phase 4）で入る系列で、
// 今はデモデータだけが持つ。実データに無いときは凡例から外し、その旨を表示する。

import { useMemo, useState } from "react"
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { useApiQuery } from "@/hooks/use-api-query"
import { DAY_NAMES, toDateStr } from "@/lib/date"
import { formatPercent, formatRooms, formatYen } from "@/lib/format"
import type { ChartTooltipEntry, ChartTooltipProps } from "@/lib/chart-tooltip"
import { api, type BookingCurve } from "@/lib/api"

export interface MonthlyBcRow {
  daysBefore: number
  /** 予約日（"M/d"） */
  label: string
  rooms: number | null
  reference: number | null
  group: number | null
  adr: number | null
  rate: number | null
}

/** 残日数ごとの行に直す（残日数の大きい順 = 予約日の古い順。純関数） */
export function buildMonthlyBcRows(curve: BookingCurve): MonthlyBcRow[] {
  const toMap = <T,>(list: T[] | undefined, lead: (v: T) => number, value: (v: T) => number | null) =>
    new Map((list ?? []).map((v) => [lead(v), value(v)]))
  const rooms = toMap(curve.points, (p) => p.daysBefore, (p) => p.roomsBooked)
  const reference = toMap(curve.reference?.points, (p) => p.daysBefore, (p) => p.roomsBooked)
  const group = toMap(curve.groupRooms, (p) => p.daysBefore, (p) => p.rooms)
  const adr = toMap(curve.adrHistory, (p) => p.daysBefore, (p) => p.adr)
  const rate = toMap(curve.rateHistory, (p) => p.daysBefore, (p) => p.price)
  const maxLead = Math.max(0, ...rooms.keys(), ...reference.keys(), ...group.keys(), ...adr.keys(), ...rate.keys())
  const [y, m, d] = curve.stayDate.split("-").map(Number)
  return Array.from({ length: maxLead + 1 }, (_, i) => {
    const lead = maxLead - i
    const date = new Date(y, m - 1, d - lead)
    return {
      daysBefore: lead,
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      rooms: rooms.get(lead) ?? null,
      reference: reference.get(lead) ?? null,
      group: group.get(lead) ?? null,
      adr: adr.get(lead) ?? null,
      rate: rate.get(lead) ?? null,
    }
  })
}

/** 既定の宿泊日: 対象月が今月なら今日、それ以外は月の15日 */
export function defaultStayDay(year: number, month: number, today = new Date()): number {
  if (today.getFullYear() === year && today.getMonth() + 1 === month) return today.getDate()
  return 15
}

function BcTooltip({ active, payload }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const row = payload[0].payload as MonthlyBcRow | undefined
  return (
    <div className="rounded-lg border border-border bg-background p-3 shadow-lg">
      <p className="mb-2 text-sm font-medium">
        予約日 {row?.label}（宿泊{row?.daysBefore === 0 ? "当日" : `${row?.daysBefore}日前`}）
      </p>
      <div className="space-y-1">
        {payload.map((entry: ChartTooltipEntry, index: number) => {
          const name = String(entry.name ?? "")
          const value = entry.value == null ? null : Number(entry.value)
          const yen = name.includes("ADR") || name.includes("HR")
          return (
            <p key={index} className="flex items-center gap-2 text-xs">
              <span className="h-0.5 w-3" style={{ backgroundColor: entry.color }} />
              <span>
                {name}: {yen ? formatYen(value) : formatRooms(value)}
              </span>
            </p>
          )
        })}
      </div>
    </div>
  )
}

interface BookingCurveMonthCardProps {
  year: number
  month: number
}

export function BookingCurveMonthCard({ year, month }: BookingCurveMonthCardProps) {
  const { hotelId } = useAuth()
  const daysInMonth = new Date(year, month, 0).getDate()
  // 対象月を切り替えたら既定の日に戻す（選んだ日は月ごとに持つ）
  const monthKey = `${year}-${month}`
  const [picked, setPicked] = useState<{ monthKey: string; day: number } | null>(null)
  const day = picked?.monthKey === monthKey ? picked.day : defaultStayDay(year, month)
  const setDay = (next: number) => setPicked({ monthKey, day: next })
  const stayDate = toDateStr(new Date(year, month - 1, Math.min(day, daysInMonth)))

  const { data: curve, loading, error, reload } = useApiQuery<BookingCurve>(
    hotelId ? () => api.bookingCurve(hotelId, stayDate) : null,
    [hotelId, stayDate],
    "ブッキングカーブの取得に失敗しました",
  )

  const rows = useMemo(() => (curve ? buildMonthlyBcRows(curve) : []), [curve])
  const hasGroup = rows.some((r) => r.group != null)
  const hasAdr = rows.some((r) => r.adr != null)
  const hasRate = rows.some((r) => r.rate != null)
  const latest = curve?.points.length ? curve.points.reduce((a, b) => (b.daysBefore < a.daysBefore ? b : a)) : null
  const referenceAtLatest = latest ? curve?.reference?.points.find((p) => p.daysBefore === latest.daysBefore) ?? null : null
  const totalRooms = curve?.totalRooms ?? null

  return (
    <Card>
      <CardHeader className="pb-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base font-medium">OCC・ADR月間BCグラフ</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              選んだ宿泊日の予約室数が、予約日ごとにどう積み上がったかを前年同曜日（参考カーブ）と比べます。左軸: 室数／右軸: 円
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Label htmlFor="bc-stay-day" className="whitespace-nowrap text-xs">
              宿泊日
            </Label>
            <Select value={String(Math.min(day, daysInMonth))} onValueChange={(v) => setDay(Number(v))}>
              <SelectTrigger id="bc-stay-day" className="h-8 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const date = new Date(year, month - 1, i + 1)
                  return (
                    <SelectItem key={i + 1} value={String(i + 1)}>
                      {month}/{i + 1}（{DAY_NAMES[date.getDay()]}）
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-2">
        {loading ? (
          <Skeleton className="h-[320px] w-full" />
        ) : error || !curve ? (
          <ErrorState message={error ?? "ブッキングカーブの取得に失敗しました"} onRetry={reload} />
        ) : rows.length <= 1 && curve.points.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            この宿泊日の予約の記録（OTB の取り込み）がありません。設定の「予約数（OTB）の取り込み」で毎日の予約室数を取り込むと表示されます。
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div className="rounded-md border px-3 py-2">
                <dt className="text-xs text-muted-foreground">{curve.actual ? "結果" : "現在の予約"}</dt>
                <dd className="font-semibold tabular-nums">
                  {formatRooms(curve.actual?.soldRooms ?? latest?.roomsBooked ?? null)}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    {formatPercent(curve.actual?.occupancy ?? latest?.occupancy ?? null)}
                  </span>
                </dd>
              </div>
              <div className="rounded-md border px-3 py-2">
                <dt className="text-xs text-muted-foreground">前年同曜日の同時点</dt>
                <dd className="font-semibold tabular-nums">
                  {formatRooms(referenceAtLatest?.roomsBooked ?? null)}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">最終 {formatRooms(curve.reference?.finalRooms ?? null)}</span>
                </dd>
              </div>
              <div className="rounded-md border px-3 py-2">
                <dt className="text-xs text-muted-foreground">AI予測（着地）</dt>
                <dd className="font-semibold tabular-nums">
                  {formatRooms(curve.prediction?.rooms ?? null)}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">{formatPercent(curve.prediction?.occupancy ?? null)}</span>
                </dd>
              </div>
              <div className="rounded-md border px-3 py-2">
                <dt className="text-xs text-muted-foreground">予算（室数・ADR）</dt>
                <dd className="font-semibold tabular-nums">
                  {formatRooms(curve.budget?.rooms ?? null)}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">{formatYen(curve.budget?.adr ?? null)}</span>
                </dd>
              </div>
            </dl>
            <ResponsiveContainer width="100%" height={340}>
              <ComposedChart data={rows} margin={{ top: 10, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={24} stroke="currentColor" opacity={0.5} />
                <YAxis
                  yAxisId="rooms"
                  tick={{ fontSize: 11 }}
                  stroke="currentColor"
                  opacity={0.5}
                  domain={[0, totalRooms ? Math.ceil((totalRooms * 1.15) / 10) * 10 : "auto"]}
                />
                <YAxis
                  yAxisId="yen"
                  orientation="right"
                  tick={{ fontSize: 11 }}
                  stroke="currentColor"
                  opacity={0.5}
                  width={72}
                  domain={[0, (max: number) => Math.ceil((Math.max(max, curve.budget?.adr ?? 0) * 1.2) / 1000) * 1000]}
                  tickFormatter={(v) => `¥${Number(v).toLocaleString()}`}
                />
                <Tooltip content={<BcTooltip />} />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                {hasGroup && (
                  <Area yAxisId="rooms" type="stepAfter" dataKey="group" name="GROUP" fill="var(--chart-2)" fillOpacity={0.5} stroke="var(--chart-2)" />
                )}
                {totalRooms != null && (
                  <ReferenceLine yAxisId="rooms" y={totalRooms} ifOverflow="extendDomain" stroke="currentColor" strokeWidth={2} label={{ value: `客室 ${totalRooms}`, position: "insideTopLeft", fontSize: 10 }} />
                )}
                {curve.budget?.adr != null && (
                  // 実データでは円の軸に線が無いことがある（ADR・HR は PMS 連携後）。そのままだと軸の範囲外として消えるので広げる
                  <ReferenceLine yAxisId="yen" y={curve.budget.adr} ifOverflow="extendDomain" stroke="var(--chart-4)" strokeWidth={2} label={{ value: "予算ADR", position: "insideBottomRight", fontSize: 10 }} />
                )}
                <Line yAxisId="rooms" type="linear" dataKey="reference" name="参考カーブ（前年同曜日）" stroke="#f19a9a" strokeWidth={1.5} dot={false} connectNulls />
                <Line yAxisId="rooms" type="linear" dataKey="rooms" name="Booking Curve" stroke="var(--positive)" strokeWidth={3} dot={false} connectNulls />
                {hasAdr && <Line yAxisId="yen" type="linear" dataKey="adr" name="ADR" stroke="var(--negative)" strokeWidth={1.5} dot={false} connectNulls />}
                {hasRate && (
                  <Line yAxisId="yen" type="stepAfter" dataKey="rate" name="HR（販売価格）" stroke="var(--negative)" strokeDasharray="5 3" strokeWidth={1.5} dot={false} connectNulls />
                )}
              </ComposedChart>
            </ResponsiveContainer>
            {(!hasAdr || !hasRate || !hasGroup) && (
              <p className="text-[11px] text-muted-foreground">
                {[!hasAdr && "予約のADRの推移", !hasRate && "販売価格の履歴（HR）", !hasGroup && "団体（GROUP）"].filter(Boolean).join("・")}
                は、PMS・サイトコントローラー連携後に表示します。
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
