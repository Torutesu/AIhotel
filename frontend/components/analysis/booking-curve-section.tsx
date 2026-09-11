"use client"

// ブッキングカーブ（U-15 で daily-analysis-tab.tsx から分割）
// 稼働率の実測カーブは GET /daily/booking-curve の実データ。
// ADR・前年・予算の系列と表示区分の内訳は対応APIが未実装のためサンプル表示。

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
import { SampleDataNotice } from "@/components/sample-data-notice"
import { useAuth } from "@/components/auth-provider"
import { api, ApiClientError, type BookingCurve } from "@/lib/api"
import { startOfToday } from "@/lib/date"
import { formatYen as yen } from "@/lib/format"
import { toNumber, type ChartTooltipEntry, type ChartTooltipProps } from "@/lib/chart-tooltip"

// ブッキングカーブの表示区分（全体 / 部屋タイプ別 / 利用人数別）。
// モックアップのため係数でスケールした系列を表示する
const CURVE_SEGMENTS: Record<string, Array<{ value: string; label: string; occFactor: number; adrFactor: number }>> = {
  total: [{ value: "total", label: "全体", occFactor: 1, adrFactor: 1 }],
  roomType: [
    { value: "standard", label: "スタンダード", occFactor: 1.0, adrFactor: 1.0 },
    { value: "deluxe", label: "デラックス", occFactor: 0.94, adrFactor: 1.35 },
    { value: "suite", label: "スイート", occFactor: 0.82, adrFactor: 1.9 },
  ],
  occupancy: [
    { value: "1p", label: "1名利用", occFactor: 0.52, adrFactor: 0.78 },
    { value: "2p", label: "2名利用", occFactor: 0.31, adrFactor: 1.32 },
    { value: "3p", label: "3名利用", occFactor: 0.12, adrFactor: 1.65 },
    { value: "4p", label: "4名以上", occFactor: 0.05, adrFactor: 1.95 },
  ],
}

// 月単位ブッキングカーブ（モックデータ。宿泊月からの残月数ごとの予約積み上げ）
const MONTHLY_BOOKING_CURVE = [
  { monthsBefore: 6, monthly: 500, cumulative: 1800, lastYearCumulative: 1600 },
  { monthsBefore: 5, monthly: 700, cumulative: 3800, lastYearCumulative: 3300 },
  { monthsBefore: 4, monthly: 900, cumulative: 7000, lastYearCumulative: 6300 },
  { monthsBefore: 3, monthly: 1400, cumulative: 12000, lastYearCumulative: 11000 },
  { monthsBefore: 2, monthly: 2600, cumulative: 20000, lastYearCumulative: 18200 },
  { monthsBefore: 1, monthly: 4800, cumulative: 28000, lastYearCumulative: 26000 },
  { monthsBefore: 0, monthly: 1200, cumulative: 30200, lastYearCumulative: 28400 },
]

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
  const [curveSegmentType, setCurveSegmentType] = useState<"total" | "roomType" | "occupancy">("total")
  const [curveSegmentValue, setCurveSegmentValue] = useState("total")

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

  const curveSegment = useMemo(() => {
    const options = CURVE_SEGMENTS[curveSegmentType]
    return options.find((o) => o.value === curveSegmentValue) ?? options[0]
  }, [curveSegmentType, curveSegmentValue])

  // 宿泊日までの残日数（この日数より大きい daysBefore は「観測済み＝当日まで」の実績、小さい側はAI予測）
  const daysUntilStay = useMemo(() => {
    if (!selectedStayDate) return 0
    const diff = Math.ceil((selectedStayDate.getTime() - todayDateOnly.getTime()) / 86400000)
    return Math.max(0, diff)
  }, [selectedStayDate, todayDateOnly])

  // X軸: daysBefore を右肩上がり（宿泊日に近づくほど右）に表示するため降順のまま reversed 指定。
  // 現在ADR・現在稼働率とそれぞれのAI予測（当日以降は破線）、前年実績・予算を表示する。
  // ADR・前年・予算は対応APIが未整備のため実測カーブから決定的に導出したモック値
  const bookingCurveData = useMemo(() => {
    if (!bookingCurve) return []
    const sorted = [...bookingCurve.points].sort((a, b) => b.daysBefore - a.daysBefore)
    const maxDays = sorted.length > 0 ? sorted[0].daysBefore : 90
    return sorted.map((p, idx) => {
      const observed = p.daysBefore >= daysUntilStay
      const next = sorted[idx + 1]
      const isBoundary = observed && !!next && next.daysBefore < daysUntilStay
      const occ = Math.round(p.occupancy * curveSegment.occFactor * 1000) / 10
      const adr = Math.round(((14000 + p.occupancy * 5500) * curveSegment.adrFactor) / 10) * 10
      const progress = maxDays > 0 ? (maxDays - p.daysBefore) / maxDays : 1
      const lastYearOcc = Math.round(occ * 0.92 * 10) / 10
      const budgetOcc = Math.round(85 * curveSegment.occFactor * Math.pow(progress, 0.7) * 10) / 10
      return {
        daysBefore: p.daysBefore,
        occActual: observed ? occ : null,
        occForecast: !observed || isBoundary ? occ : null,
        adrActual: observed ? adr : null,
        adrForecast: !observed || isBoundary ? adr : null,
        lastYearOcc,
        budgetOcc,
      }
    })
  }, [bookingCurve, daysUntilStay, curveSegment])

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
                    {name}: {name.includes("ADR") ? yen(value) : `${value}%`}
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
              value={curveSegmentType}
              onValueChange={(v: "total" | "roomType" | "occupancy") => {
                setCurveSegmentType(v)
                setCurveSegmentValue(CURVE_SEGMENTS[v][0].value)
              }}
            >
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="total">全体</SelectItem>
                <SelectItem value="roomType">部屋タイプ別</SelectItem>
                <SelectItem value="occupancy">利用人数別</SelectItem>
              </SelectContent>
            </Select>
            {curveSegmentType !== "total" && (
              <Select value={curveSegmentValue} onValueChange={setCurveSegmentValue}>
                <SelectTrigger className="h-8 w-32 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURVE_SEGMENTS[curveSegmentType].map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
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
          <div className="space-y-2">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={MONTHLY_BOOKING_CURVE} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
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
                <Line type="monotone" dataKey="cumulative" stroke="#2563eb" strokeWidth={3} dot={{ r: 4 }} name="累積予約室数" />
                <Line type="monotone" dataKey="monthly" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} name="当月予約室数" />
                <Line
                  type="monotone"
                  dataKey="lastYearCumulative"
                  stroke="#9ca3af"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                  name="前年累積予約室数"
                />
              </LineChart>
            </ResponsiveContainer>
            <SampleDataNotice detail="月単位のブッキングカーブは対応APIが未実装のため、表示イメージ（サンプル）です。" />
          </div>
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
                  tickFormatter={(value) => `${value}%`}
                  label={{ value: '稼働率', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fontSize: 12 } }}
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
                <Line yAxisId="left" type="monotone" dataKey="occActual" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3 }} name="現在稼働率" connectNulls={false} />
                <Line yAxisId="left" type="monotone" dataKey="occForecast" stroke="#2563eb" strokeWidth={2.5} strokeDasharray="5 5" dot={false} name="稼働率（AI予測）" connectNulls={false} />
                <Line yAxisId="right" type="monotone" dataKey="adrActual" stroke="#ef4444" strokeWidth={2.5} dot={{ r: 3 }} name="現在ADR" connectNulls={false} />
                <Line yAxisId="right" type="monotone" dataKey="adrForecast" stroke="#ef4444" strokeWidth={2.5} strokeDasharray="5 5" dot={false} name="ADR（AI予測）" connectNulls={false} />
                <Line yAxisId="left" type="monotone" dataKey="lastYearOcc" stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="3 3" dot={false} name="前年稼働率" />
                <Line yAxisId="left" type="monotone" dataKey="budgetOcc" stroke="#16a34a" strokeWidth={1.5} strokeDasharray="8 4" dot={false} name="予算稼働率" />
              </LineChart>
            </ResponsiveContainer>
            <SampleDataNotice detail="稼働率の実測カーブは実データですが、ADR・前年・予算の系列と表示区分（部屋タイプ別・利用人数別）の内訳は対応APIが未実装のためサンプルです。" />
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