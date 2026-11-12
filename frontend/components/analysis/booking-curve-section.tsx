"use client"

// ブッキングカーブ（U-15 で daily-analysis-tab.tsx から分割。D-13 ですべて実データに）
// 日単位: GET /daily/booking-curve。稼働室数の実測・前年同曜日（364日前）・日割り予算・AI の予測に加え、
//   予約明細があれば ADR の推移（adrHistory）と利用人数別の内訳（breakdowns）。縦軸は稼働室数（2026-10 PDF c分析03）。
// 月単位: GET /analysis/month-curve（予約明細の残月数ごとの積み上がり・前年・月の予算）。
// 部屋タイプ別の内訳は予約明細に部屋タイプが無いため、データがあるとき（デモ）だけ選べる。無い系列は描かない（作り値で埋めない）。

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts"
import { format } from "date-fns"
import { ja } from "date-fns/locale/ja"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { DatePicker } from "@/components/date-picker"
import { ErrorState } from "@/components/error-state"
import { useAuth } from "@/components/auth-provider"
import { useApiQuery } from "@/hooks/use-api-query"
import { api, ApiClientError, type BookingCurve, type MonthCurve } from "@/lib/api"
import { startOfToday } from "@/lib/date"
import { formatYen as yen } from "@/lib/format"
import { toNumber, type ChartTooltipEntry, type ChartTooltipProps } from "@/lib/chart-tooltip"

type SegmentType = "total" | "roomType" | "guests"
const SEGMENT_TYPE_LABELS: Record<SegmentType, string> = { total: "全体", roomType: "部屋タイプ別", guests: "利用人数別" }

/** 表示区分の選択肢。データのある区分だけ（日単位は breakdowns、月単位は利用人数の区分）。純関数 */
export function curveSegmentOptions(
  unit: "daily" | "monthly",
  bookingCurve: BookingCurve | null,
  monthCurve: MonthCurve | null,
): { options: Record<SegmentType, string[]>; types: SegmentType[] } {
  const options: Record<SegmentType, string[]> =
    unit === "monthly"
      ? { total: [], roomType: [], guests: monthCurve && monthCurve.reservations > 0 ? monthCurve.segmentNames : [] }
      : {
          total: [],
          roomType: (bookingCurve?.breakdowns?.roomType ?? []).map((s) => s.label),
          guests: (bookingCurve?.breakdowns?.guests ?? []).map((s) => s.label),
        }
  const types = (Object.keys(SEGMENT_TYPE_LABELS) as SegmentType[]).filter((t) => t === "total" || options[t].length > 0)
  return { options, types }
}

/** ブッキングカーブグラフ（実データ: api.bookingCurve。表示単位・表示区分のセレクタを含む） */
interface BookingCurveSectionProps {
  /** 表示する宿泊日。省略時は内部stateで管理する */
  stayDate?: Date
  onStayDateChange?: (date: Date | undefined) => void
}

export function BookingCurveSection({
  stayDate: stayDateProp,
  onStayDateChange,
}: BookingCurveSectionProps = {}) {
  const { hotelId } = useAuth()

  // 現在の日付（実績/予測の境界判定用）。毎レンダーで作り直すと useMemo の依存が
  // 常に変化してしまうため、マウント時に 1 度だけ確定させる。
  const todayDateOnly = useMemo(() => startOfToday(), [])

  // ---- ブッキングカーブ（実データ: api.bookingCurve） ----
  const [internalStayDate, setInternalStayDate] = useState<Date | undefined>(() => {
    const d = new Date()
    d.setDate(d.getDate() + 7)
    return d
  })
  const selectedStayDate = stayDateProp ?? internalStayDate
  const setSelectedStayDate = (date: Date | undefined) => {
    setInternalStayDate(date)
    onStayDateChange?.(date)
  }
  const [bookingCurve, setBookingCurve] = useState<BookingCurve | null>(null)
  const [bookingCurveLoading, setBookingCurveLoading] = useState(false)
  const [bookingCurveError, setBookingCurveError] = useState<string | null>(null)
  // 表示単位（日単位 / 月単位）と表示区分（全体 / 部屋タイプ別 / 利用人数別）
  const [curveUnit, setCurveUnit] = useState<"daily" | "monthly">("daily")
  const [curveSegmentType, setCurveSegmentType] = useState<SegmentType>("total")
  const [curveSegmentValue, setCurveSegmentValue] = useState("")

  const loadBookingCurve = useCallback(async () => {
    if (!hotelId || !selectedStayDate) return
    setBookingCurveLoading(true)
    setBookingCurveError(null)
    try {
      const dateStr = format(selectedStayDate, "yyyy-MM-dd")
      const result = await api.bookingCurve(hotelId, dateStr)
      setBookingCurve(result)
    } catch (err) {
      setBookingCurveError(err instanceof ApiClientError ? err.message : "ブッキングカーブの取得に失敗しました")
    } finally {
      setBookingCurveLoading(false)
    }
  }, [hotelId, selectedStayDate])

  useEffect(() => {
    loadBookingCurve()
  }, [loadBookingCurve])

  // 月単位（宿泊日の月。予約明細から）
  const stayYear = selectedStayDate?.getFullYear() ?? 0
  const stayMonth = selectedStayDate ? selectedStayDate.getMonth() + 1 : 0
  const monthCurve = useApiQuery<MonthCurve>(
    hotelId && selectedStayDate && curveUnit === "monthly" ? () => api.monthCurve(hotelId, stayYear, stayMonth) : null,
    [hotelId, stayYear, stayMonth, curveUnit],
    "月単位のブッキングカーブの取得に失敗しました",
  )

  const { options: segmentOptions, types: availableTypes } = useMemo(
    () => curveSegmentOptions(curveUnit, bookingCurve, monthCurve.data),
    [curveUnit, bookingCurve, monthCurve.data],
  )
  const segmentType: SegmentType = availableTypes.includes(curveSegmentType) ? curveSegmentType : "total"
  const segmentValue = segmentOptions[segmentType].includes(curveSegmentValue) ? curveSegmentValue : (segmentOptions[segmentType][0] ?? "")
  const monthlyData = useMemo(() => {
    if (!monthCurve.data) return []
    return monthCurve.data.points.map((p) => ({
      monthsBefore: p.monthsBefore,
      cumulative: segmentType === "guests" ? (p.segments[segmentValue] ?? 0) : p.cumulative,
      monthly: segmentType === "total" ? p.monthly : null,
      lastYearCumulative: segmentType === "total" ? p.lastYearCumulative : null,
    }))
  }, [monthCurve.data, segmentType, segmentValue])

  const daysUntilStay = useMemo(() => {
    if (!selectedStayDate) return 0
    const diff = Math.ceil((selectedStayDate.getTime() - todayDateOnly.getTime()) / 86400000)
    return Math.max(0, diff)
  }, [selectedStayDate, todayDateOnly])

  // X軸: daysBefore を右肩上がり（宿泊日に近づくほど右）に表示するため降順のまま reversed 指定。
  // 全体: 稼働室数の実測・前年同曜日・予約の ADR。AI の予測は今日の実測から宿泊日の予測室数への破線。
  // 区分別: その区分の予約室数と ADR（前年・予算・AI の予測は全体にしか無いので出さない）
  const bookingCurveData = useMemo(() => {
    if (!bookingCurve) return []
    const rows = new Map<number, { daysBefore: number; occActual: number | null; occForecast: number | null; adrActual: number | null; lastYearOcc: number | null }>()
    const row = (daysBefore: number) => {
      let r = rows.get(daysBefore)
      if (!r) {
        r = { daysBefore, occActual: null, occForecast: null, adrActual: null, lastYearOcc: null }
        rows.set(daysBefore, r)
      }
      return r
    }
    if (segmentType === "total") {
      for (const p of bookingCurve.points) row(p.daysBefore).occActual = p.roomsBooked
      if (bookingCurve.actual?.soldRooms != null && daysUntilStay === 0) row(0).occActual = bookingCurve.actual.soldRooms
      for (const p of bookingCurve.reference?.points ?? []) row(p.daysBefore).lastYearOcc = p.roomsBooked
      for (const a of bookingCurve.adrHistory ?? []) if (a.adr != null) row(a.daysBefore).adrActual = a.adr
      // AI の予測: 直近の実測から宿泊日の予測室数へ
      const latest = [...bookingCurve.points].sort((a, b) => a.daysBefore - b.daysBefore)[0]
      if (bookingCurve.prediction && daysUntilStay > 0 && latest) {
        row(latest.daysBefore).occForecast = latest.roomsBooked
        row(0).occForecast = bookingCurve.prediction.rooms
      }
    } else {
      const series = (bookingCurve.breakdowns?.[segmentType] ?? []).find((s) => s.label === segmentValue)
      for (const p of series?.points ?? []) {
        row(p.daysBefore).occActual = p.roomsBooked
        row(p.daysBefore).adrActual = p.adr
      }
    }
    return [...rows.values()].sort((a, b) => b.daysBefore - a.daysBefore)
  }, [bookingCurve, daysUntilStay, segmentType, segmentValue])
  const hasAdr = bookingCurveData.some((r) => r.adrActual != null)
  const hasLastYear = bookingCurveData.some((r) => r.lastYearOcc != null)
  const hasForecast = bookingCurveData.some((r) => r.occForecast != null)
  const budgetRooms = segmentType === "total" ? (bookingCurve?.budget?.rooms ?? null) : null

  const maxDaysBefore = bookingCurveData.length > 0 ? bookingCurveData[0].daysBefore : 90

  const BookingCurveTooltip = ({ active, payload }: ChartTooltipProps) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload
      return (
        <div className="bg-background border border-border rounded-lg shadow-lg p-3">
          <p className="text-sm font-medium mb-2">宿泊 {data?.daysBefore}日前</p>
          <div className="space-y-1">
            {payload.map((entry: ChartTooltipEntry, index: number) => {
              const name = String(entry.name ?? "")
              const value = toNumber(entry.value)
              return (
                <p key={index} className="text-xs flex items-center gap-2">
                  <span className="w-3 h-0.5" style={{ backgroundColor: entry.color }}></span>
                  <span>
                    {name}: {name.includes("ADR") ? yen(value) : `${value.toLocaleString()}室`}
                  </span>
                </p>
              )
            })}
          </div>
        </div>
      )
    }
    return null
  }

  const MonthlyCurveTooltip = ({ active, payload }: ChartTooltipProps) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload
      return (
        <div className="bg-background border border-border rounded-lg shadow-lg p-3">
          <p className="text-sm font-medium mb-2">宿泊 {data?.monthsBefore}か月前</p>
          <div className="space-y-1">
            {payload.map((entry: ChartTooltipEntry, index: number) => (
              <p key={index} className="text-xs flex items-center gap-2">
                <span className="w-3 h-0.5" style={{ backgroundColor: entry.color }}></span>
                <span>
                  {entry.name}: {toNumber(entry.value).toLocaleString()}室
                </span>
              </p>
            ))}
          </div>
        </div>
      )
    }
    return null
  }

  return (
    /* Booking Curve Graph */
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-base font-medium">ブッキングカーブグラフ</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {curveUnit === "monthly"
                ? `宿泊月 ${selectedStayDate ? format(selectedStayDate, "yyyy年M月", { locale: ja }) : ""} の予約積み上げ状況（月単位）`
                : selectedStayDate
                  ? `宿泊日 ${format(selectedStayDate, "yyyy年M月d日", { locale: ja })} の予約状況（当日までは実線、当日以降のAI予測は破線）`
                  : "宿泊日を選択してください"}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={curveUnit} onValueChange={(v: "daily" | "monthly") => setCurveUnit(v)}>
              <SelectTrigger className="h-8 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">日単位</SelectItem>
                <SelectItem value="monthly">月単位</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={segmentType}
              onValueChange={(v: SegmentType) => {
                setCurveSegmentType(v)
                setCurveSegmentValue(segmentOptions[v][0] ?? "")
              }}
            >
              <SelectTrigger className="h-8 w-32 text-xs" aria-label="表示区分">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {SEGMENT_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {segmentType !== "total" && (
              <Select value={segmentValue} onValueChange={setCurveSegmentValue}>
                <SelectTrigger className="h-8 w-32 text-xs" aria-label="区分">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {segmentOptions[segmentType].map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <DatePicker
              id="booking-curve-stay-date"
              value={selectedStayDate}
              onChange={setSelectedStayDate}
              placeholder="宿泊日を選択"
              ariaLabel="ブッキングカーブの宿泊日"
              align="end"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {curveUnit === "monthly" ? (
          monthCurve.loading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : monthCurve.error ? (
            <ErrorState message={monthCurve.error} onRetry={monthCurve.reload} />
          ) : !monthCurve.data || monthCurve.data.reservations === 0 ? (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground" data-testid="no-month-curve">
              この月の予約明細がまだ取り込まれていません。設定タブの「予約明細から作る」で取り込むと、月単位の積み上がりを表示します。
            </p>
          ) : (
          <div className="space-y-2">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthlyData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                <XAxis
                  dataKey="monthsBefore"
                  tick={{ fontSize: 11 }}
                  stroke="currentColor"
                  opacity={0.5}
                  reversed={true}
                  type="number"
                  domain={[0, 6]}
                  label={{ value: '宿泊月までの残月数', position: 'insideBottom', offset: -5, style: { textAnchor: 'middle', fontSize: 12 } }}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="currentColor"
                  opacity={0.5}
                  label={{ value: '予約室数', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fontSize: 12 } }}
                />
                <Tooltip content={<MonthlyCurveTooltip />} />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                {segmentType === "total" && monthCurve.data.budgetRooms != null && (
                  <ReferenceLine y={monthCurve.data.budgetRooms} stroke="#16a34a" strokeDasharray="8 4" label={{ value: "月の予算", position: "insideTopLeft", fill: "#16a34a", fontSize: 11 }} />
                )}
                <Line type="monotone" dataKey="cumulative" stroke="#2563eb" strokeWidth={3} dot={{ r: 4 }} name={segmentType === "total" ? "累積予約室数" : `累積予約室数（${segmentValue}）`} />
                {segmentType === "total" && <Line type="monotone" dataKey="monthly" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} name="その月に入った室数" />}
                {segmentType === "total" && monthlyData.some((p) => p.lastYearCumulative != null) && (
                  <Line type="monotone" dataKey="lastYearCumulative" stroke="#9ca3af" strokeWidth={2} strokeDasharray="5 5" dot={false} name="前年累積予約室数" />
                )}
              </LineChart>
            </ResponsiveContainer>
            <p className="text-[10px] text-muted-foreground">
              予約明細 {monthCurve.data.reservations.toLocaleString()}件から集計。残月数1は宿泊月の前月末まで、0は月末（最終）の時点です。取消は取り消した時点から外します。
            </p>
          </div>
          )
        ) : bookingCurveLoading ? (
          <Skeleton className="h-[300px] w-full" />
        ) : bookingCurveError ? (
          <ErrorState message={bookingCurveError} onRetry={loadBookingCurve} />
        ) : bookingCurveData.length > 0 ? (
          <div className="space-y-2">
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={bookingCurveData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                <XAxis
                  dataKey="daysBefore"
                  tick={{ fontSize: 11 }}
                  stroke="currentColor"
                  opacity={0.5}
                  reversed={true}
                  type="number"
                  domain={[0, maxDaysBefore]}
                  label={{ value: '宿泊日までの残日数', position: 'insideBottom', offset: -5, style: { textAnchor: 'middle', fontSize: 12 } }}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 11 }}
                  stroke="currentColor"
                  opacity={0.5}
                  tickFormatter={(value) => `${value}室`}
                  label={{ value: '稼働室数', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fontSize: 12 } }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 11 }}
                  stroke="currentColor"
                  opacity={0.5}
                  tickFormatter={(value) => `¥${(value / 1000).toFixed(0)}k`}
                  label={{ value: 'ADR（円）', angle: 90, position: 'insideRight', style: { textAnchor: 'middle', fontSize: 12 } }}
                />
                <Tooltip content={<BookingCurveTooltip />} />
                <Legend wrapperStyle={{ fontSize: "12px" }} />
                {daysUntilStay > 0 && daysUntilStay <= maxDaysBefore && (
                  <ReferenceLine
                    x={daysUntilStay}
                    yAxisId="left"
                    stroke="#666"
                    strokeDasharray="5 5"
                    strokeWidth={1.5}
                    label={{ value: "本日", position: "top", fill: "#666", fontSize: 11 }}
                  />
                )}
                {budgetRooms != null && (
                  <ReferenceLine y={budgetRooms} yAxisId="left" stroke="#16a34a" strokeDasharray="8 4" label={{ value: "予算", position: "insideTopLeft", fill: "#16a34a", fontSize: 11 }} />
                )}
                <Line yAxisId="left" type="monotone" dataKey="occActual" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3 }} name={segmentType === "total" ? "稼働室数" : `予約室数（${segmentValue}）`} connectNulls />
                {hasForecast && (
                  <Line yAxisId="left" type="linear" dataKey="occForecast" stroke="#2563eb" strokeWidth={2.5} strokeDasharray="5 5" dot={false} name="稼働室数（AI予測）" connectNulls />
                )}
                {hasAdr && <Line yAxisId="right" type="monotone" dataKey="adrActual" stroke="#ef4444" strokeWidth={2.5} dot={false} name="予約のADR" connectNulls />}
                {hasLastYear && (
                  <Line yAxisId="left" type="monotone" dataKey="lastYearOcc" stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="3 3" dot={false} name="前年同曜日の稼働室数" connectNulls />
                )}
              </LineChart>
            </ResponsiveContainer>
            {!hasAdr && segmentType === "total" && (
              <p className="text-[10px] text-muted-foreground">予約の ADR と利用人数別の内訳は、設定タブの「予約明細から作る」で室料・人数の入った予約明細を取り込むと表示します。</p>
            )}
          </div>
        ) : (
          <div className="text-center py-8 text-sm text-muted-foreground">
            選択した宿泊日のブッキングカーブデータがありません
          </div>
        )}
      </CardContent>
    </Card>
  )
}