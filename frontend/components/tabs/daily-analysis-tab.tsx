"use client"

import { useState, useMemo, useEffect, useCallback, Fragment } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar as DatePicker } from "@/components/ui/calendar"
import { Skeleton } from "@/components/ui/skeleton"
import { CalendarIcon, TrendingUp, TrendingDown, BarChart3, Settings, RefreshCw, AlertCircle } from "lucide-react"
import { SegmentCrossAnalysisSettings } from "@/components/segment-cross-analysis-settings"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, Area, AreaChart, Cell } from "recharts"
import { AlertTriangle } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { format } from "date-fns"
import { ja } from "date-fns/locale/ja"

import { useAuth } from "@/components/auth-provider"
import { api, ApiClientError, type BookingCurve, type CompetitorPrices } from "@/lib/api"

function yen(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "-"
  return `¥${Math.round(value).toLocaleString()}`
}

function occLabel(occ: number): string {
  return occ >= 4 ? "4名以上" : `${occ}名`
}

function avgOf(rows: Array<Record<string, any>>, key: string): number | null {
  const vals = rows.map((r) => r[key]).filter((v): v is number => v != null)
  if (vals.length === 0) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

export function DailyAnalysisTab() {
  const { hotelId } = useAuth()
  const [targetMonth, setTargetMonth] = useState("2025-04")
  const [viewMode, setViewMode] = useState<"table" | "segment-settings">("table")

  // 現在の日付を取得（過去/未来判定用）
  const today = new Date()
  const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate())

  // 日付が過去かどうかを判定する関数
  const isPastDate = (dateStr: string, monthStr: string) => {
    const [month, day] = dateStr.split("/").map(Number)
    const [year, monthNum] = monthStr.split("-").map(Number)
    const rowDate = new Date(year, monthNum - 1, day)
    const rowDateOnly = new Date(rowDate.getFullYear(), rowDate.getMonth(), rowDate.getDate())
    return rowDateOnly < todayDateOnly
  }

  // ---- ブッキングカーブ（実データ: api.bookingCurve） ----
  const [selectedStayDate, setSelectedStayDate] = useState<Date | undefined>(() => {
    const d = new Date()
    d.setDate(d.getDate() + 7)
    return d
  })
  const [bookingCurve, setBookingCurve] = useState<BookingCurve | null>(null)
  const [bookingCurveLoading, setBookingCurveLoading] = useState(false)
  const [bookingCurveError, setBookingCurveError] = useState<string | null>(null)

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

  // X軸: daysBefore を右肩上がり（宿泊日に近づくほど右）に表示するため降順のまま reversed 指定
  const bookingCurveData = useMemo(() => {
    if (!bookingCurve) return []
    const sorted = [...bookingCurve.points].sort((a, b) => b.daysBefore - a.daysBefore)
    return sorted.map((p, idx) => ({
      daysBefore: p.daysBefore,
      roomsBooked: p.roomsBooked,
      occupancy: Math.round(p.occupancy * 1000) / 10,
      incremental: idx > 0 ? p.roomsBooked - sorted[idx - 1].roomsBooked : p.roomsBooked,
    }))
  }, [bookingCurve])

  const maxDaysBefore = bookingCurveData.length > 0 ? bookingCurveData[0].daysBefore : 90

  const BookingCurveTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload
      return (
        <div className="bg-background border border-border rounded-lg shadow-lg p-3">
          <p className="text-sm font-medium mb-2">宿泊 {data.daysBefore}日前</p>
          <div className="space-y-1">
            {payload.map((entry: any, index: number) => (
              <p key={index} className="text-xs flex items-center gap-2">
                <span className="w-3 h-0.5" style={{ backgroundColor: entry.color }}></span>
                <span>
                  {entry.name}: {entry.value}室
                </span>
              </p>
            ))}
          </div>
        </div>
      )
    }
    return null
  }

  // ---- 競合価格比較（実データ: api.competitorPrices） ----
  const [startDate, setStartDate] = useState(() => format(new Date(), "yyyy-MM-dd"))
  const [endDate, setEndDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 13)
    return format(d, "yyyy-MM-dd")
  })
  const [selectedOccupancies, setSelectedOccupancies] = useState<number[]>([1])
  const [selectedCompetitorIds, setSelectedCompetitorIds] = useState<string[]>([])
  const [competitorData, setCompetitorData] = useState<CompetitorPrices | null>(null)
  const [competitorLoading, setCompetitorLoading] = useState(false)
  const [competitorError, setCompetitorError] = useState<string | null>(null)

  const loadCompetitorPrices = useCallback(async () => {
    if (!hotelId) return
    setCompetitorLoading(true)
    setCompetitorError(null)
    try {
      const result = await api.competitorPrices(hotelId, startDate, endDate)
      setCompetitorData(result)
      setSelectedCompetitorIds((prev) => {
        if (prev.length > 0) return prev.filter((id) => result.competitors.some((c) => c.id === id))
        return result.competitors.slice(0, 3).map((c) => c.id)
      })
    } catch (err) {
      setCompetitorError(err instanceof ApiClientError ? err.message : "競合価格の取得に失敗しました")
    } finally {
      setCompetitorLoading(false)
    }
  }, [hotelId, startDate, endDate])

  useEffect(() => {
    loadCompetitorPrices()
  }, [loadCompetitorPrices])

  const selectedCompetitors = useMemo(
    () => (competitorData?.competitors ?? []).filter((c) => selectedCompetitorIds.includes(c.id)),
    [competitorData, selectedCompetitorIds]
  )

  const priceKeyFor = (occ: number): "price1P" | "price2P" | "price3P" =>
    occ === 1 ? "price1P" : occ === 2 ? "price2P" : "price3P"

  // 各日付に対して、当ホテル価格・選択された競合の人数別価格をまとめたグラフ用データ
  const competitorComparisonData = useMemo(() => {
    if (!competitorData) return []
    const ownByDate = new Map(competitorData.ownPrices.map((p) => [p.date, p]))
    const compByDate = selectedCompetitors.map((c) => ({
      id: c.id,
      name: c.name,
      byDate: new Map(c.prices.map((p) => [p.date, p])),
    }))

    const dates = competitorData.ownPrices.map((p) => p.date)
    return dates.map((date) => {
      const d = new Date(date)
      const own = ownByDate.get(date)
      const result: any = {
        date: `${d.getMonth() + 1}/${d.getDate()}`,
        day: ["日", "月", "火", "水", "木", "金", "土"][d.getDay()],
        ourPrice: own?.price ?? null,
      }
      for (const comp of compByDate) {
        const priceRow = comp.byDate.get(date)
        for (const occ of selectedOccupancies) {
          result[`${comp.id}_${occ}名`] = priceRow ? priceRow[priceKeyFor(occ)] : null
        }
      }
      return result
    })
  }, [competitorData, selectedCompetitors, selectedOccupancies])

  const CompetitorTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload
      return (
        <div className="bg-background border border-border rounded-lg shadow-lg p-3">
          <p className="text-sm font-medium mb-2">{data.date} ({data.day})</p>
          <div className="space-y-1">
            {payload.map((entry: any, index: number) => (
              <p key={index} className="text-xs flex items-center gap-2">
                <span className="w-3 h-0.5" style={{ backgroundColor: entry.color }}></span>
                <span>
                  {entry.name}: {entry.value != null ? `¥${Math.round(entry.value).toLocaleString()}` : "-"}
                </span>
              </p>
            ))}
          </div>
        </div>
      )
    }
    return null
  }


  // セグメント別クロス分析設定表示の場合
  if (viewMode === "segment-settings") {
    return (
      <div className="p-4">
        <div className="mb-4 flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setViewMode("table")} className="gap-2">
            <BarChart3 className="w-4 h-4" />
            日別分析に戻る
          </Button>
        </div>
        <SegmentCrossAnalysisSettings
          onSave={(settings) => {
            // 設定を保存し、基本分析に反映する処理
            console.log("Settings saved:", settings)
            // 実際の実装では、ここでAPIを呼び出して設定を保存
            // 例: await saveSegmentAnalysisSettings(settings)

            // 保存成功後、設定画面に留まる（ユーザーがさらに調整できるように）
            // または、必要に応じて日別分析画面に戻る
            // setViewMode("table")
          }}
        />
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-balance">日別分析</h2>
          <p className="text-sm text-muted-foreground mt-1">日次パフォーマンスの詳細分析</p>
        </div>
        <Button onClick={() => setViewMode("segment-settings")} variant="outline" size="sm" className="gap-2">
          <Settings className="w-4 h-4" />
          セグメント別クロス分析設定
        </Button>
      </div>

      {/* AI解説セクション - 一番上に配置 */}
      <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <span className="text-xl">🤖</span>
            日別分析インサイト
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-2 text-sm leading-relaxed">
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-[color:var(--positive)] mt-2 flex-shrink-0" />
              <p>
                週末（金・土）の稼働率は平均95.6%と非常に高く、ADRも¥23,300と好調です。この傾向は今後も継続する見込みです。
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-[color:var(--negative)] mt-2 flex-shrink-0" />
              <p>
                月曜日の稼働率が56.7%と最も低く、改善の余地があります。曜日限定のプランの導入を検討してください。
              </p>
            </div>
            <div className="flex items-start gap-3">
              <div className="w-2 h-2 rounded-full bg-[color:var(--chart-2)] mt-2 flex-shrink-0" />
              <p>
                4月5日と12日の土曜日は満室を達成しており、需要が非常に高い状態です。さらなる価格最適化の機会があります。
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ControlsとSummaryを1つのCardに統合 */}
      <Card>
        <CardContent className="py-2.5 px-3">
          {/* フィルターコントロール */}
          <div className="flex items-center gap-3 flex-wrap mb-2.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="target-month-daily" className="text-xs whitespace-nowrap">対象月</Label>
              <Select value={targetMonth} onValueChange={setTargetMonth}>
                <SelectTrigger id="target-month-daily" className="h-8 w-32 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2025-02">2025年2月</SelectItem>
                  <SelectItem value="2025-03">2025年3月</SelectItem>
                  <SelectItem value="2025-04">2025年4月</SelectItem>
                  <SelectItem value="2025-05">2025年5月</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-1.5">
              <Label htmlFor="view-mode" className="text-xs whitespace-nowrap">表示形式</Label>
              <Select
                value="table"
                onValueChange={(value) => {
                  if (value === "table" || value === "segment-settings") {
                    setViewMode(value)
                  }
                }}
              >
                <SelectTrigger id="view-mode" className="h-8 w-32 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="table">テーブル表示</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* サマリーカードを横並びに */}
          <div className="grid grid-cols-4 gap-3 border-t pt-2.5">
            <div className="flex flex-col">
              <p className="text-xs text-muted-foreground mb-0.5">月間平均ADR</p>
              <div className="text-lg font-semibold mb-0.5">¥18,250</div>
              <div className="flex items-center gap-1">
                <TrendingUp className="w-3 h-3 text-[color:var(--positive)]" />
                <span className="text-xs text-[color:var(--positive)]">+3.2% vs 前月</span>
              </div>
            </div>

            <div className="flex flex-col">
              <p className="text-xs text-muted-foreground mb-0.5">月間平均稼働率</p>
              <div className="text-lg font-semibold mb-0.5">82.5%</div>
              <div className="flex items-center gap-1">
                <TrendingDown className="w-3 h-3 text-[color:var(--negative)]" />
                <span className="text-xs text-[color:var(--negative)]">-1.8% vs 前月</span>
              </div>
            </div>

            <div className="flex flex-col">
              <p className="text-xs text-muted-foreground mb-0.5">最高ADR日</p>
              <div className="text-lg font-semibold mb-0.5">¥26,500</div>
              <p className="text-xs text-muted-foreground">4月5日（土）</p>
            </div>

            <div className="flex flex-col">
              <p className="text-xs text-muted-foreground mb-0.5">最低ADR日</p>
              <div className="text-lg font-semibold mb-0.5">¥14,800</div>
              <p className="text-xs text-muted-foreground">4月14日（月）</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Daily Performance Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">日別パフォーマンス（2025年4月）</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-2 font-medium">日付</th>
                  <th className="text-left py-2 px-2 font-medium">曜日</th>
                  <th className="text-right py-2 px-2 font-medium">販売室数</th>
                  <th className="text-right py-2 px-2 font-medium">稼働率</th>
                  <th className="text-right py-2 px-2 font-medium">ADR</th>
                  <th className="text-right py-2 px-2 font-medium">RevPAR</th>
                  <th className="text-right py-2 px-2 font-medium">室料売上</th>
                  <th className="text-center py-2 px-2 font-medium">前年比</th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    date: "4/1",
                    day: "火",
                    rooms: 22000,
                    occ: 73.3,
                    occAi: 75.0,
                    adr: 17200,
                    adrAi: 17500,
                    revpar: 12607,
                    revparAi: 13125,
                    revenue: 378400000,
                    revenueAi: 385000000,
                    yoy: 5.2,
                  },
                  {
                    date: "4/2",
                    day: "水",
                    rooms: 20000,
                    occ: 66.7,
                    occAi: 68.0,
                    adr: 16800,
                    adrAi: 17000,
                    revpar: 11206,
                    revparAi: 11560,
                    revenue: 336000000,
                    revenueAi: 340000000,
                    yoy: 3.8,
                  },
                  {
                    date: "4/3",
                    day: "木",
                    rooms: 24000,
                    occ: 80.0,
                    occAi: 82.0,
                    adr: 17500,
                    adrAi: 17800,
                    revpar: 14000,
                    revparAi: 14596,
                    revenue: 420000000,
                    revenueAi: 427200000,
                    yoy: 8.5,
                  },
                  {
                    date: "4/4",
                    day: "金",
                    rooms: 28000,
                    occ: 93.3,
                    occAi: 95.0,
                    adr: 21500,
                    adrAi: 22000,
                    revpar: 20067,
                    revparAi: 20900,
                    revenue: 602000000,
                    revenueAi: 616000000,
                    yoy: 12.3,
                  },
                  {
                    date: "4/5",
                    day: "土",
                    rooms: 30000,
                    occ: 100.0,
                    occAi: 100.0,
                    adr: 26500,
                    adrAi: 27000,
                    revpar: 26500,
                    revparAi: 27000,
                    revenue: 795000000,
                    revenueAi: 810000000,
                    yoy: 18.7,
                  },
                  {
                    date: "4/6",
                    day: "日",
                    rooms: 29000,
                    occ: 96.7,
                    occAi: 98.0,
                    adr: 23800,
                    adrAi: 24200,
                    revpar: 23013,
                    revparAi: 23716,
                    revenue: 690200000,
                    revenueAi: 701800000,
                    yoy: 15.2,
                  },
                  { 
                    date: "4/7", 
                    day: "月", 
                    rooms: 18000, 
                    occ: 60.0, 
                    occAi: 62.0,
                    adr: 16200, 
                    adrAi: 16500,
                    revpar: 9720, 
                    revparAi: 10230,
                    revenue: 291600000, 
                    revenueAi: 297000000,
                    yoy: 2.1 
                  },
                  {
                    date: "4/8",
                    day: "火",
                    rooms: 21000,
                    occ: 70.0,
                    occAi: 72.0,
                    adr: 16500,
                    adrAi: 16800,
                    revpar: 11550,
                    revparAi: 12096,
                    revenue: 346500000,
                    revenueAi: 352800000,
                    yoy: 4.5,
                  },
                  {
                    date: "4/9",
                    day: "水",
                    rooms: 19000,
                    occ: 63.3,
                    occAi: 65.0,
                    adr: 16000,
                    adrAi: 16200,
                    revpar: 10133,
                    revparAi: 10530,
                    revenue: 304000000,
                    revenueAi: 307800000,
                    yoy: 1.8,
                  },
                  {
                    date: "4/10",
                    day: "木",
                    rooms: 23000,
                    occ: 76.7,
                    occAi: 78.0,
                    adr: 17000,
                    adrAi: 17300,
                    revpar: 13033,
                    revparAi: 13494,
                    revenue: 391000000,
                    revenueAi: 397900000,
                    yoy: 6.9,
                  },
                  {
                    date: "4/11",
                    day: "金",
                    rooms: 27000,
                    occ: 90.0,
                    occAi: 92.0,
                    adr: 20500,
                    adrAi: 21000,
                    revpar: 18450,
                    revparAi: 19320,
                    revenue: 553500000,
                    revenueAi: 567000000,
                    yoy: 10.8,
                  },
                  {
                    date: "4/12",
                    day: "土",
                    rooms: 30000,
                    occ: 100.0,
                    occAi: 100.0,
                    adr: 25000,
                    adrAi: 25500,
                    revpar: 25000,
                    revparAi: 25500,
                    revenue: 750000000,
                    revenueAi: 765000000,
                    yoy: 16.4,
                  },
                  {
                    date: "4/13",
                    day: "日",
                    rooms: 28000,
                    occ: 93.3,
                    occAi: 95.0,
                    adr: 22500,
                    adrAi: 23000,
                    revpar: 21000,
                    revparAi: 21850,
                    revenue: 630000000,
                    revenueAi: 644000000,
                    yoy: 13.5,
                  },
                  {
                    date: "4/14",
                    day: "月",
                    rooms: 16000,
                    occ: 53.3,
                    occAi: 55.0,
                    adr: 14800,
                    adrAi: 15000,
                    revpar: 7893,
                    revparAi: 8250,
                    revenue: 236800000,
                    revenueAi: 240000000,
                    yoy: -2.3,
                  },
                ].map((row) => {
                  const isPast = isPastDate(row.date, targetMonth)
                  const isSelectedForCurve =
                    !!selectedStayDate && format(selectedStayDate, "M/d") === row.date
                  return (
                    <tr
                      key={row.date}
                      className={`border-b hover:bg-muted/50 cursor-pointer ${isPast ? "opacity-60" : ""}`}
                      onClick={() => {
                        const [monthNum, dayNum] = row.date.split("/").map(Number)
                        const [yearNum] = targetMonth.split("-").map(Number)
                        setSelectedStayDate(new Date(yearNum, monthNum - 1, dayNum))
                      }}
                    >
                      <td className={`py-2 px-2 font-medium ${isSelectedForCurve ? "bg-blue-100 dark:bg-blue-900" : ""}`}>{row.date}</td>
                      <td className="py-2 px-2">
                        <Badge variant={row.day === "土" || row.day === "日" ? "default" : "outline"} className="text-xs">{row.day}</Badge>
                      </td>
                      <td className="text-right py-2 px-2">{row.rooms}室</td>
                      <td className="text-right py-2 px-2">
                        {isPast ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-[color:var(--muted-foreground)] text-[10px]">実績: {row.occ.toFixed(1)}%</span>
                            <span className="text-[color:var(--muted-foreground)] text-[10px]">AI推奨: {row.occAi.toFixed(1)}%</span>
                          </div>
                        ) : (
                          <span
                            className={
                              row.occAi >= 90
                                ? "text-[color:var(--positive)] font-medium"
                                : row.occAi < 70
                                  ? "text-[color:var(--negative)]"
                                  : ""
                            }
                          >
                            {row.occAi.toFixed(1)}%
                          </span>
                        )}
                      </td>
                      <td className="text-right py-2 px-2">
                        {isPast ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-[color:var(--muted-foreground)] text-[10px]">実績: ¥{row.adr.toLocaleString()}</span>
                            <span className="text-[color:var(--muted-foreground)] text-[10px]">AI推奨: ¥{row.adrAi.toLocaleString()}</span>
                          </div>
                        ) : (
                          <>¥{row.adrAi.toLocaleString()}</>
                        )}
                      </td>
                      <td className="text-right py-2 px-2">
                        {isPast ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-[color:var(--muted-foreground)] text-[10px]">実績: ¥{row.revpar.toLocaleString()}</span>
                            <span className="text-[color:var(--muted-foreground)] text-[10px]">AI推奨: ¥{row.revparAi.toLocaleString()}</span>
                          </div>
                        ) : (
                          <>¥{row.revparAi.toLocaleString()}</>
                        )}
                      </td>
                      <td className="text-right py-2 px-2 font-medium">
                        {isPast ? (
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-[color:var(--muted-foreground)] text-[10px]">実績: ¥{row.revenue.toLocaleString()}</span>
                            <span className="text-[color:var(--muted-foreground)] text-[10px]">AI推奨: ¥{row.revenueAi.toLocaleString()}</span>
                          </div>
                        ) : (
                          <>¥{row.revenueAi.toLocaleString()}</>
                        )}
                      </td>
                      <td className="text-center py-2 px-2">
                        {isPast ? (
                          <span className={row.yoy >= 0 ? "text-[color:var(--positive)]" : "text-[color:var(--negative)]"}>
                            {row.yoy >= 0 ? "+" : ""}
                            {row.yoy.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-[color:var(--muted-foreground)]">-</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="border-t-2">
                <tr className="bg-muted/30">
                  <td className="py-2 px-2 font-semibold" colSpan={2}>
                    合計 / 平均
                  </td>
                  <td className="text-right py-2 px-2 font-semibold">335,000室</td>
                  <td className="text-right py-2 px-2 font-semibold">79.8%</td>
                  <td className="text-right py-2 px-2 font-semibold">¥19,107</td>
                  <td className="text-right py-2 px-2 font-semibold">¥15,248</td>
                  <td className="text-right py-2 px-2 font-semibold">¥6,405,000,000</td>
                  <td className="text-center py-2 px-2 font-semibold text-[color:var(--positive)]">+8.4%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Booking Curve Graph */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="text-base">ブッキングカーブグラフ</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {selectedStayDate ? `宿泊日 ${format(selectedStayDate, "yyyy年M月d日", { locale: ja })} の予約積み上げ状況` : "宿泊日を選択してください"}
              </p>
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-2">
                  <CalendarIcon className="w-3.5 h-3.5" />
                  {selectedStayDate ? format(selectedStayDate, "yyyy/MM/dd") : "宿泊日を選択"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <DatePicker mode="single" selected={selectedStayDate} onSelect={setSelectedStayDate} initialFocus />
              </PopoverContent>
            </Popover>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {bookingCurveLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : bookingCurveError ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <AlertCircle className="w-6 h-6 text-destructive" />
              <p className="text-sm text-muted-foreground">{bookingCurveError}</p>
              <Button variant="outline" size="sm" onClick={loadBookingCurve} className="gap-2">
                <RefreshCw className="w-4 h-4" />
                再試行
              </Button>
            </div>
          ) : bookingCurveData.length > 0 ? (
            <div className="space-y-4">
              <ResponsiveContainer width="100%" height={300}>
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
                    tick={{ fontSize: 11 }}
                    stroke="currentColor"
                    opacity={0.5}
                    label={{ value: '予約室数', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fontSize: 12 } }}
                  />
                  <Tooltip content={<BookingCurveTooltip />} />
                  <Legend wrapperStyle={{ fontSize: "12px" }} />
                  <Line
                    type="monotone"
                    dataKey="roomsBooked"
                    stroke="#2563eb"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                    name="累積予約室数"
                  />
                  <Line
                    type="monotone"
                    dataKey="incremental"
                    stroke="#ef4444"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    name="区間予約室数"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-center py-8 text-sm text-muted-foreground">
              選択した宿泊日のブッキングカーブデータがありません
            </div>
          )}
        </CardContent>
      </Card>

      {/* Day of Week Analysis */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">曜日別パフォーマンス分析</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-2 font-medium">曜日</th>
                  <th className="text-right py-2 px-2 font-medium">平均稼働率</th>
                  <th className="text-right py-2 px-2 font-medium">平均ADR</th>
                  <th className="text-right py-2 px-2 font-medium">平均RevPAR</th>
                  <th className="text-right py-2 px-2 font-medium">前年比</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { day: "月曜日", occ: 56.7, adr: 15500, revpar: 8807, yoy: -0.1 },
                  { day: "火曜日", occ: 71.7, adr: 16900, revpar: 12117, yoy: 4.9 },
                  { day: "水曜日", occ: 65.0, adr: 16400, revpar: 10660, yoy: 2.8 },
                  { day: "木曜日", occ: 78.4, adr: 17250, revpar: 13517, yoy: 7.7 },
                  { day: "金曜日", occ: 91.7, adr: 21000, revpar: 19258, yoy: 11.6 },
                  { day: "土曜日", occ: 100.0, adr: 25750, revpar: 25750, yoy: 17.6 },
                  { day: "日曜日", occ: 95.0, adr: 23150, revpar: 21993, yoy: 14.4 },
                ].map((row) => (
                  <tr key={row.day} className="border-b hover:bg-muted/50">
                    <td className="py-2 px-2 font-medium">{row.day}</td>
                    <td className="text-right py-2 px-2">{row.occ.toFixed(1)}%</td>
                    <td className="text-right py-2 px-2">¥{row.adr.toLocaleString()}</td>
                    <td className="text-right py-2 px-2">¥{row.revpar.toLocaleString()}</td>
                    <td className="text-right py-2 px-2">
                      <span className={row.yoy >= 0 ? "text-[color:var(--positive)]" : "text-[color:var(--negative)]"}>
                        {row.yoy >= 0 ? "+" : ""}
                        {row.yoy.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Competitor Comparison Section */}
      <Card className="border-l-4 border-l-orange-500">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              競合ホテルとの価格比較分析
            </CardTitle>
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="competitor-start-date" className="text-xs whitespace-nowrap">期間</Label>
                <input
                  id="competitor-start-date"
                  type="date"
                  value={startDate}
                  max={endDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                />
                <span className="text-xs text-muted-foreground">〜</span>
                <input
                  id="competitor-end-date"
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs whitespace-nowrap">利用人数:</Label>
                <div className="flex items-center gap-3 flex-wrap">
                  {[1, 2, 3].map((occ) => (
                    <div key={occ} className="flex items-center gap-1.5">
                      <Checkbox
                        id={`occupancy-${occ}`}
                        checked={selectedOccupancies.includes(occ)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedOccupancies([...selectedOccupancies, occ].sort())
                          } else {
                            const newOccupancies = selectedOccupancies.filter((o) => o !== occ)
                            // 少なくとも1つは選択されている必要がある
                            if (newOccupancies.length > 0) {
                              setSelectedOccupancies(newOccupancies)
                            }
                          }
                        }}
                      />
                      <Label htmlFor={`occupancy-${occ}`} className="text-xs cursor-pointer">
                        {occ}名利用
                      </Label>
                    </div>
                  ))}
                  <div className="flex items-center gap-1.5">
                    <Checkbox
                      id="occupancy-4plus"
                      checked={selectedOccupancies.some((o) => o >= 4)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          // 4名以上を選択（4として扱う）
                          if (!selectedOccupancies.includes(4)) {
                            setSelectedOccupancies([...selectedOccupancies, 4].sort())
                          }
                        } else {
                          // 4名以上を削除
                          setSelectedOccupancies(selectedOccupancies.filter((o) => o < 4))
                        }
                      }}
                    />
                    <Label htmlFor="occupancy-4plus" className="text-xs cursor-pointer">
                      4名以上
                    </Label>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs whitespace-nowrap">比較ホテル:</Label>
                <div className="flex items-center gap-3 flex-wrap">
                  {(competitorData?.competitors ?? []).map((c) => (
                    <div key={c.id} className="flex items-center gap-1.5">
                      <Checkbox
                        id={`competitor-${c.id}`}
                        checked={selectedCompetitorIds.includes(c.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedCompetitorIds([...selectedCompetitorIds, c.id])
                          } else {
                            const newIds = selectedCompetitorIds.filter((id) => id !== c.id)
                            // 少なくとも1つは選択されている必要がある
                            if (newIds.length > 0) {
                              setSelectedCompetitorIds(newIds)
                            }
                          }
                        }}
                      />
                      <Label htmlFor={`competitor-${c.id}`} className="text-xs cursor-pointer">
                        {c.name}
                      </Label>
                    </div>
                  ))}
                  {competitorData && competitorData.competitors.length === 0 && (
                    <span className="text-xs text-muted-foreground">登録された競合ホテルがありません</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-4">
          {/* 注意事項アラート */}
          <Alert className="bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <AlertTitle className="text-sm font-semibold text-amber-900 dark:text-amber-100">データ取り扱いに関する注意事項</AlertTitle>
            <AlertDescription className="text-xs text-amber-800 dark:text-amber-200 mt-1 space-y-1">
              <p>• 競合データは参考値であり、実際の価格設定には複数の要因（立地、設備、サービス品質等）を総合的に考慮してください。</p>
              <p>• 表示期間: {startDate} 〜 {endDate}</p>
              <p>• データ取得日時: {new Date().toLocaleString("ja-JP")}</p>
            </AlertDescription>
          </Alert>

          {competitorLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : competitorError ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <AlertCircle className="w-6 h-6 text-destructive" />
              <p className="text-sm text-muted-foreground">{competitorError}</p>
              <Button variant="outline" size="sm" onClick={loadCompetitorPrices} className="gap-2">
                <RefreshCw className="w-4 h-4" />
                再試行
              </Button>
            </div>
          ) : selectedCompetitors.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">比較する競合ホテルを選択してください。</p>
          ) : (
            <>
              {/* サマリーカード - ホテルごとに行を分けて表示 */}
              <div className="space-y-3">
                {selectedCompetitors.map((comp) => (
                  <div key={comp.id} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold">{comp.name}</h4>
                      <div className="flex-1 border-t border-border"></div>
                    </div>
                    <div className="flex gap-3 flex-wrap">
                      {selectedOccupancies.map((occ) => {
                        const ourAvg = avgOf(competitorComparisonData, "ourPrice")
                        const compAvg = avgOf(competitorComparisonData, `${comp.id}_${occ}名`)
                        const diff = ourAvg != null && compAvg != null ? ourAvg - compAvg : null
                        const diffPercent = diff != null && compAvg ? (diff / compAvg) * 100 : null

                        return (
                          <Card key={`${comp.id}-${occ}`} className="min-w-[200px] flex-1 max-w-[250px]">
                            <CardContent className="py-2.5 px-3">
                              <p className="text-xs text-muted-foreground mb-1">{occLabel(occ)}</p>
                              <div className="text-lg font-semibold mb-0.5">
                                {yen(ourAvg)} / {yen(compAvg)}
                              </div>
                              {diff != null && diffPercent != null ? (
                                <div
                                  className={`text-sm font-medium ${diff >= 0 ? "text-[color:var(--positive)]" : "text-[color:var(--negative)]"}`}
                                >
                                  {diff >= 0 ? "+" : ""}
                                  {yen(Math.abs(diff))} ({diff >= 0 ? "+" : ""}
                                  {diffPercent.toFixed(1)}%)
                                </div>
                              ) : (
                                <div className="text-sm text-muted-foreground">-</div>
                              )}
                              <p className="text-xs text-muted-foreground mt-1">当ホテル / {comp.name}</p>
                            </CardContent>
                          </Card>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* 日別価格推移グラフ - 複数の人数とホテルに対応 */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">日別価格推移比較</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={competitorComparisonData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                      <defs>
                        <linearGradient id="colorOurPrice" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#2563eb" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                        </linearGradient>
                        {selectedCompetitors.flatMap((comp, compIdx) =>
                          selectedOccupancies.map((occ) => (
                            <linearGradient
                              key={`comp-${comp.id}-${occ}`}
                              id={`colorCompetitorPrice_${comp.id}_${occ}`}
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1"
                            >
                              <stop offset="5%" stopColor={compIdx === 0 ? "#ef4444" : compIdx === 1 ? "#f59e0b" : "#ec4899"} stopOpacity={0.3} />
                              <stop offset="95%" stopColor={compIdx === 0 ? "#ef4444" : compIdx === 1 ? "#f59e0b" : "#ec4899"} stopOpacity={0} />
                            </linearGradient>
                          ))
                        )}
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10 }}
                        stroke="currentColor"
                        opacity={0.5}
                        label={{ value: '日付', position: 'insideBottom', offset: -5, style: { textAnchor: 'middle', fontSize: 11 } }}
                      />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        stroke="currentColor"
                        opacity={0.5}
                        tickFormatter={(value) => `¥${(value / 1000).toFixed(0)}k`}
                        label={{ value: '価格', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fontSize: 11 } }}
                      />
                      <Tooltip content={<CompetitorTooltip />} />
                      <Legend wrapperStyle={{ fontSize: "11px" }} />
                      <Area
                        type="monotone"
                        dataKey="ourPrice"
                        stroke="#2563eb"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#colorOurPrice)"
                        name="当ホテル"
                        connectNulls
                      />
                      {selectedCompetitors.flatMap((comp, compIdx) =>
                        selectedOccupancies.map((occ, occIdx) => (
                          <Area
                            key={`comp-${comp.id}-${occ}`}
                            type="monotone"
                            dataKey={`${comp.id}_${occ}名`}
                            stroke={compIdx === 0 ? "#ef4444" : compIdx === 1 ? "#f59e0b" : "#ec4899"}
                            strokeWidth={2}
                            fillOpacity={1}
                            fill={`url(#colorCompetitorPrice_${comp.id}_${occ})`}
                            name={`${comp.name} (${occLabel(occ)})`}
                            strokeDasharray={occIdx > 0 ? "5 5" : undefined}
                            connectNulls
                          />
                        ))
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* 価格差の可視化 - 複数の組み合わせに対応 */}
              {selectedOccupancies.flatMap((occ) =>
                selectedCompetitors.map((comp) => {
                  const priceDiffData = competitorComparisonData.map((d) => ({
                    date: d.date,
                    priceDifference:
                      d.ourPrice != null && d[`${comp.id}_${occ}名`] != null ? d.ourPrice - d[`${comp.id}_${occ}名`] : null,
                  }))

                  return (
                    <Card key={`diff-${comp.id}-${occ}`}>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm">価格差の可視化</CardTitle>
                        <p className="text-xs text-muted-foreground mt-1">
                          当ホテルと{comp.name}の価格差 ({occLabel(occ)})
                        </p>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <ResponsiveContainer width="100%" height={250}>
                          <BarChart data={priceDiffData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                            <XAxis
                              dataKey="date"
                              tick={{ fontSize: 10 }}
                              stroke="currentColor"
                              opacity={0.5}
                              angle={-45}
                              textAnchor="end"
                              height={60}
                            />
                            <YAxis
                              tick={{ fontSize: 10 }}
                              stroke="currentColor"
                              opacity={0.5}
                              tickFormatter={(value) => `¥${(value / 1000).toFixed(0)}k`}
                              label={{ value: '価格差', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fontSize: 11 } }}
                            />
                            <Tooltip content={<CompetitorTooltip />} />
                            <Bar dataKey="priceDifference" radius={[4, 4, 0, 0]} name="価格差">
                              {priceDiffData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={(entry.priceDifference ?? 0) >= 0 ? "#2563eb" : "#ef4444"} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  )
                })
              )}

              {/* 曜日別競合価格比較テーブル - 選択期間の実データ平均 */}
              {selectedOccupancies.map((occ) => {
                const weekdayRows = ["月", "火", "水", "木", "金", "土", "日"].map((dayName) => {
                  const rows = competitorComparisonData.filter((d) => d.day === dayName)
                  return {
                    day: dayName,
                    ourPrice: avgOf(rows, "ourPrice"),
                    competitors: selectedCompetitors.map((comp) => ({
                      id: comp.id,
                      name: comp.name,
                      price: avgOf(rows, `${comp.id}_${occ}名`),
                    })),
                  }
                })

                return (
                  <Card key={`table-${occ}`}>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">曜日別競合価格比較 ({occLabel(occ)})</CardTitle>
                      <p className="text-xs text-muted-foreground">
                        選択期間（{startDate} 〜 {endDate}）内の実績平均
                      </p>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-2 px-2 font-medium">曜日</th>
                              <th className="text-right py-2 px-2 font-medium">当ホテル</th>
                              {selectedCompetitors.map((comp) => (
                                <Fragment key={comp.id}>
                                  <th className="text-right py-2 px-2 font-medium">{comp.name}</th>
                                  <th className="text-right py-2 px-2 font-medium">価格差</th>
                                  <th className="text-right py-2 px-2 font-medium">差額率</th>
                                </Fragment>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {weekdayRows.map((row) => (
                              <tr key={row.day} className="border-b hover:bg-muted/50">
                                <td className="py-2 px-2 font-medium">{row.day}曜日</td>
                                <td className="text-right py-2 px-2 font-medium">{yen(row.ourPrice)}</td>
                                {row.competitors.map((comp) => {
                                  const diff = row.ourPrice != null && comp.price != null ? row.ourPrice - comp.price : null
                                  const diffPercent = diff != null && comp.price ? (diff / comp.price) * 100 : null
                                  return (
                                    <Fragment key={comp.id}>
                                      <td className="text-right py-2 px-2">{yen(comp.price)}</td>
                                      <td
                                        className={`text-right py-2 px-2 font-medium ${
                                          diff != null && diff >= 0
                                            ? "text-[color:var(--positive)]"
                                            : diff != null
                                              ? "text-[color:var(--negative)]"
                                              : ""
                                        }`}
                                      >
                                        {diff != null ? `${diff >= 0 ? "+" : ""}${yen(Math.abs(diff))}` : "-"}
                                      </td>
                                      <td
                                        className={`text-right py-2 px-2 ${
                                          diffPercent != null && diffPercent >= 0
                                            ? "text-[color:var(--positive)]"
                                            : diffPercent != null
                                              ? "text-[color:var(--negative)]"
                                              : ""
                                        }`}
                                      >
                                        {diffPercent != null ? `${diffPercent >= 0 ? "+" : ""}${diffPercent.toFixed(1)}%` : "-"}
                                      </td>
                                    </Fragment>
                                  )
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </>
          )}
        </CardContent>
      </Card>

    </div>
  )
}
