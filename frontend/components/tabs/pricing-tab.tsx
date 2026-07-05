"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Slider } from "@/components/ui/slider"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertCircle, Table2, Calendar, Edit2, Save, CheckCircle2, Info, RefreshCw, Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Bar, ComposedChart, Legend } from "recharts"
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

import { useAuth } from "@/components/auth-provider"
import { api, ApiClientError, type PricingCalendarDay, type PricingStrategy, type CreateEventInput } from "@/lib/api"
import type { Event as HotelEvent } from "@shared/types"

const EVENT_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "concert", label: "コンサート" },
  { value: "sports", label: "スポーツ" },
  { value: "conference", label: "カンファレンス" },
  { value: "festival", label: "祭り・催事" },
  { value: "other", label: "その他" },
]

function eventTypeLabel(type: string): string {
  return EVENT_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type
}

function impactBadgeClass(impact?: string | null): string {
  switch (impact) {
    case "high":
      return "bg-red-500 text-white"
    case "medium":
      return "bg-yellow-500 text-black"
    case "low":
      return "bg-blue-400 text-white"
    default:
      return "bg-muted text-muted-foreground"
  }
}

function impactLabel(impact?: string | null): string {
  switch (impact) {
    case "high":
      return "影響度:高"
    case "medium":
      return "影響度:中"
    case "low":
      return "影響度:低"
    default:
      return "影響度:不明"
  }
}

function formatEventDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })
}

function formatEventRange(start: Date | string, end: Date | string): string {
  const s = formatEventDate(start)
  const e = formatEventDate(end)
  return s === e ? s : `${s} 〜 ${e}`
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

const DAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"]

// 料金ランクのバッジカラー（バックエンドは40段階でランクを管理 — backend/prisma/seed.ts の PRICE_RANK_COUNT）
const PRICE_RANK_COUNT = 40
function getRankBadgeColor(rank: number): string {
  const band = Math.ceil((rank / PRICE_RANK_COUNT) * 5)
  if (band <= 1) return "bg-blue-500 text-white"
  if (band <= 2) return "bg-cyan-500 text-white"
  if (band <= 3) return "bg-green-500 text-white"
  if (band <= 4) return "bg-yellow-500 text-black"
  return "bg-red-500 text-white"
}

function demandBadgeClass(demand: string | null): string {
  switch (demand) {
    case "A":
      return "bg-blue-600 text-white"
    case "B":
      return "bg-blue-400 text-white"
    case "C":
      return "bg-gray-300 text-gray-800"
    case "D":
      return "bg-orange-200 text-orange-800"
    case "E":
      return "bg-red-200 text-red-800"
    default:
      return "bg-muted text-muted-foreground"
  }
}

function demandDescription(demand: string | null): string {
  switch (demand) {
    case "A":
      return "需要が非常に高い"
    case "B":
      return "需要が高い"
    case "C":
      return "需要は平均的"
    case "D":
      return "需要が低い"
    case "E":
      return "需要が非常に低い"
    default:
      return "需要予測データがありません"
  }
}

function statusLabel(demand: string | null): { label: string; variant: "default" | "secondary" | "outline" } {
  if (demand === "A" || demand === "B") return { label: "値上推奨", variant: "secondary" }
  if (demand === "D" || demand === "E") return { label: "需要喚起要検討", variant: "outline" }
  return { label: "適正", variant: "outline" }
}

function avg(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((v): v is number => v != null)
  if (valid.length === 0) return null
  return valid.reduce((a, b) => a + b, 0) / valid.length
}

function yen(value: number | null | undefined): string {
  if (value == null) return "-"
  return `¥${Math.round(value).toLocaleString()}`
}

function pct(value: number | null | undefined): string {
  if (value == null) return "-"
  return `${(value * 100).toFixed(1)}%`
}

function monthLabelOf(year: number, month: number): string {
  return `${year}年${month}月`
}

interface MonthCalendar {
  year: number
  month: number
  calendar: PricingCalendarDay[]
}

export function PricingTab() {
  const { hotelId } = useAuth()

  const now = new Date()
  const [targetMonth, setTargetMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`)
  const [displayMonths, setDisplayMonths] = useState("1")
  const [roomType, setRoomType] = useState("all")
  const [calendarViewMode, setCalendarViewMode] = useState<"table" | "grid">("table")

  const [monthsData, setMonthsData] = useState<MonthCalendar[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedDay, setSelectedDay] = useState<{ monthIndex: number; day: PricingCalendarDay } | null>(null)
  const [selectedRowForAnalysis, setSelectedRowForAnalysis] = useState<{ monthIndex: number; day: PricingCalendarDay } | null>(null)

  // 日別のイベント情報・外部要因メモ（該当する日単位の自由記述を保存するAPIが未整備のため画面内の一時メモとして保持）
  const [eventInfoMap, setEventInfoMap] = useState<Record<string, { eventInfo?: string; externalFactors?: string }>>({})
  const [isEditingEventInfo, setIsEditingEventInfo] = useState(false)
  const [editingEventInfo, setEditingEventInfo] = useState("")
  const [editingExternalFactors, setEditingExternalFactors] = useState("")

  // 当月のイベント情報管理（実API接続 — F-DP-07）
  const [events, setEvents] = useState<HotelEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(true)
  const [eventsError, setEventsError] = useState<string | null>(null)
  const [isEventDialogOpen, setIsEventDialogOpen] = useState(false)
  const [savingEvent, setSavingEvent] = useState(false)
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null)
  const [newEventName, setNewEventName] = useState("")
  const [newEventType, setNewEventType] = useState("concert")
  const [newEventStart, setNewEventStart] = useState("")
  const [newEventEnd, setNewEventEnd] = useState("")
  const [newEventImpact, setNewEventImpact] = useState<"high" | "medium" | "low">("medium")
  const [newEventLocation, setNewEventLocation] = useState("")

  const monthRange = useMemo(() => {
    const [yearStr, monthStr] = targetMonth.split("-")
    const baseYear = Number.parseInt(yearStr, 10)
    const baseMonth = Number.parseInt(monthStr, 10)
    const count = Number.parseInt(displayMonths, 10)
    const start = new Date(baseYear, baseMonth - 1, 1)
    const end = new Date(baseYear, baseMonth - 1 + count, 0)
    return { startDate: toDateStr(start), endDate: toDateStr(end) }
  }, [targetMonth, displayMonths])

  // 価格戦略の重み付け
  const [strategy, setStrategy] = useState<PricingStrategy | null>(null)
  const [weightOccupancy, setWeightOccupancy] = useState(40)
  const [weightCompetitor, setWeightCompetitor] = useState(20)
  const weightAdr = Math.max(0, 100 - weightOccupancy - weightCompetitor)
  const [isWeightDialogOpen, setIsWeightDialogOpen] = useState(false)
  const [savingWeights, setSavingWeights] = useState(false)

  const applyStrategy = useCallback((s: PricingStrategy) => {
    setStrategy(s)
    setWeightOccupancy(s.weightOccupancy)
    setWeightCompetitor(s.weightCompetitor)
  }, [])

  const loadData = useCallback(async () => {
    if (!hotelId) return
    setLoading(true)
    setError(null)
    try {
      const [yearStr, monthStr] = targetMonth.split("-")
      const baseYear = Number.parseInt(yearStr, 10)
      const baseMonth = Number.parseInt(monthStr, 10)
      const count = Number.parseInt(displayMonths, 10)

      const targets = Array.from({ length: count }, (_, i) => {
        const d = new Date(baseYear, baseMonth - 1 + i, 1)
        return { year: d.getFullYear(), month: d.getMonth() + 1 }
      })

      const [calendars, strategyResult] = await Promise.all([
        Promise.all(targets.map((t) => api.pricingCalendar(hotelId, t.year, t.month))),
        api.pricingStrategy(hotelId),
      ])

      setMonthsData(calendars.map((c) => ({ year: c.year, month: c.month, calendar: c.calendar })))
      applyStrategy(strategyResult)
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "データの取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId, targetMonth, displayMonths, applyStrategy])

  useEffect(() => {
    loadData()
  }, [loadData])

  const loadEvents = useCallback(async () => {
    if (!hotelId) return
    setEventsLoading(true)
    setEventsError(null)
    try {
      const result = await api.events(hotelId, monthRange.startDate, monthRange.endDate)
      setEvents(result)
    } catch (err) {
      setEventsError(err instanceof ApiClientError ? err.message : "イベント情報の取得に失敗しました")
    } finally {
      setEventsLoading(false)
    }
  }, [hotelId, monthRange])

  useEffect(() => {
    loadEvents()
  }, [loadEvents])

  const resetNewEventForm = useCallback(() => {
    setNewEventName("")
    setNewEventType("concert")
    setNewEventStart("")
    setNewEventEnd("")
    setNewEventImpact("medium")
    setNewEventLocation("")
  }, [])

  const handleCreateEvent = useCallback(async () => {
    if (!hotelId) return
    if (!newEventName.trim() || !newEventType || !newEventStart || !newEventEnd) {
      toast.error("イベント名・種別・期間を入力してください")
      return
    }
    if (newEventStart > newEventEnd) {
      toast.error("開始日は終了日以前にしてください")
      return
    }
    setSavingEvent(true)
    try {
      const payload: CreateEventInput = {
        hotelId,
        name: newEventName.trim(),
        type: newEventType,
        startDate: newEventStart,
        endDate: newEventEnd,
        expectedImpact: newEventImpact,
        ...(newEventLocation.trim() && { location: newEventLocation.trim() }),
      }
      await api.createEvent(payload)
      toast.success("イベントを登録しました")
      setIsEventDialogOpen(false)
      resetNewEventForm()
      await loadEvents()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "イベントの登録に失敗しました")
    } finally {
      setSavingEvent(false)
    }
  }, [hotelId, newEventName, newEventType, newEventStart, newEventEnd, newEventImpact, newEventLocation, resetNewEventForm, loadEvents])

  const handleDeleteEvent = useCallback(
    async (id: string) => {
      if (!hotelId) return
      setDeletingEventId(id)
      try {
        await api.deleteEvent(id, hotelId)
        toast.success("イベントを削除しました")
        await loadEvents()
      } catch (err) {
        toast.error(err instanceof ApiClientError ? err.message : "イベントの削除に失敗しました")
      } finally {
        setDeletingEventId(null)
      }
    },
    [hotelId, loadEvents]
  )

  const handleSaveWeights = useCallback(
    async (weights?: { weightOccupancy: number; weightAdr: number; weightCompetitor: number }) => {
      if (!hotelId) return
      const payload = weights ?? { weightOccupancy, weightAdr, weightCompetitor }
      if (payload.weightOccupancy + payload.weightAdr + payload.weightCompetitor !== 100) {
        toast.error("重み付けの合計は100%にしてください")
        return
      }
      setSavingWeights(true)
      try {
        const result = await api.updatePricingStrategy(hotelId, payload)
        applyStrategy(result)
        toast.success("重み付け設定を保存しました", {
          description: `稼働率: ${result.weightOccupancy}%, ADR: ${result.weightAdr}%, 競合価格追従: ${result.weightCompetitor}%`,
        })
        setIsWeightDialogOpen(false)
      } catch (err) {
        toast.error(err instanceof ApiClientError ? err.message : "重み付け設定の保存に失敗しました")
      } finally {
        setSavingWeights(false)
      }
    },
    [hotelId, weightOccupancy, weightAdr, weightCompetitor, applyStrategy]
  )

  // 月間サマリー（実データから集計）
  const overallSummary = useMemo(() => {
    const allDays = monthsData.flatMap((m) => m.calendar)
    const actualDays = allDays.filter((d) => d.actualAdr != null)
    return {
      currentAdr: avg(actualDays.map((d) => d.actualAdr)) ?? avg(allDays.map((d) => d.recommendedPrice)),
      landingAdr: avg(allDays.map((d) => d.predictedAdr)),
      currentRevPar: avg(actualDays.map((d) => (d.actualAdr != null && d.actualOccupancy != null ? d.actualAdr * d.actualOccupancy : null))),
      landingRevPar: avg(
        allDays.map((d) => (d.predictedAdr != null && d.predictedOccupancy != null ? d.predictedAdr * d.predictedOccupancy : null))
      ),
      currentOccupancy: avg(actualDays.map((d) => d.actualOccupancy)),
      landingOccupancy: avg(allDays.map((d) => d.predictedOccupancy)),
    }
  }, [monthsData])

  const PricingTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border border-border rounded-lg shadow-lg p-3">
          <p className="text-sm font-medium mb-2">{payload[0].payload.date}</p>
          <div className="space-y-1">
            {payload.map((entry: any, index: number) => (
              <p key={index} className="text-xs flex items-center gap-2">
                <span className="w-3 h-0.5" style={{ backgroundColor: entry.color }}></span>
                <span>
                  {entry.name}: {entry.name.includes("価格") || entry.name.includes("ADR") ? `¥${Math.round(entry.value).toLocaleString()}` : `${Math.round(entry.value)}%`}
                </span>
              </p>
            ))}
          </div>
        </div>
      )
    }
    return null
  }

  if (!hotelId) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">ホテル情報を読み込んでいます...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4">
        <Card>
          <CardContent className="py-8 flex flex-col items-center gap-3 text-center">
            <AlertCircle className="w-8 h-8 text-destructive" />
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={loadData} className="gap-2">
              <RefreshCw className="w-4 h-4" />
              再試行
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold text-balance">ダイナミックプライシング</h2>
        <p className="text-sm text-muted-foreground mt-1">需要予測に基づく最適価格設定</p>
      </div>

      {/* 価格設定パラメータとサマリーを1つのCardに統合 */}
      <Card>
        <CardContent className="py-2.5 px-3">
          <h3 className="text-lg font-semibold mb-2.5">着地予測</h3>

          {/* フィルターコントロール */}
          <div className="flex items-center gap-3 flex-wrap mb-2.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="target-month" className="text-xs whitespace-nowrap">対象月</Label>
              <input
                id="target-month"
                type="month"
                value={targetMonth}
                onChange={(e) => setTargetMonth(e.target.value)}
                className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <Label htmlFor="display-months" className="text-xs whitespace-nowrap">表示月数</Label>
              <Select value={displayMonths} onValueChange={setDisplayMonths}>
                <SelectTrigger id="display-months" className="h-8 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1ヶ月</SelectItem>
                  <SelectItem value="2">2ヶ月</SelectItem>
                  <SelectItem value="3">3ヶ月</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-1.5">
              <Label htmlFor="room-type" className="text-xs whitespace-nowrap">部屋タイプ</Label>
              <Select value={roomType} onValueChange={setRoomType}>
                <SelectTrigger id="room-type" className="h-8 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全タイプ</SelectItem>
                  <SelectItem value="standard">スタンダード</SelectItem>
                  <SelectItem value="deluxe">デラックス</SelectItem>
                  <SelectItem value="suite">スイート</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 価格戦略の重み付け設定ボタン */}
            <Dialog open={isWeightDialogOpen} onOpenChange={setIsWeightDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-2">
                  <Edit2 className="w-3 h-3" />
                  重み付け設定
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[550px]">
                <DialogHeader>
                  <DialogTitle className="text-lg font-semibold">価格戦略の重み付け設定</DialogTitle>
                  <DialogDescription className="text-sm">
                    各要素の重視度を設定してください（3項目の合計は常に100%になります）。
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-6 py-4">
                  <div className="space-y-3 p-4 bg-muted/50 rounded-lg border">
                    <div className="flex justify-between items-center">
                      <Label className="text-sm font-semibold">1. 稼働率の重視度</Label>
                      <div className="flex items-center gap-1 px-3 py-1.5 bg-blue-50 dark:bg-blue-950/20 rounded-md border border-blue-200 dark:border-blue-800">
                        <span className="text-base font-bold text-blue-700 dark:text-blue-300">{weightOccupancy}</span>
                        <span className="text-xs font-medium text-blue-600 dark:text-blue-400">%</span>
                      </div>
                    </div>
                    <Slider
                      value={[weightOccupancy]}
                      onValueChange={(value) => setWeightOccupancy(Math.min(value[0], 100 - weightCompetitor))}
                      min={0}
                      max={100}
                      step={1}
                    />
                  </div>

                  <div className="space-y-3 p-4 bg-muted/50 rounded-lg border">
                    <div className="flex justify-between items-center">
                      <Label className="text-sm font-semibold">2. 競合価格追従の重視度</Label>
                      <div className="flex items-center gap-1 px-3 py-1.5 bg-purple-50 dark:bg-purple-950/20 rounded-md border border-purple-200 dark:border-purple-800">
                        <span className="text-base font-bold text-purple-700 dark:text-purple-300">{weightCompetitor}</span>
                        <span className="text-xs font-medium text-purple-600 dark:text-purple-400">%</span>
                      </div>
                    </div>
                    <Slider
                      value={[weightCompetitor]}
                      onValueChange={(value) => setWeightCompetitor(Math.min(value[0], 100 - weightOccupancy))}
                      min={0}
                      max={100}
                      step={1}
                    />
                  </div>

                  <div className="flex items-center justify-between px-2">
                    <Label className="text-sm font-medium text-muted-foreground">3. ADRの重視度（自動算出）</Label>
                    <div className="flex items-center gap-1 px-3 py-1.5 bg-green-50 dark:bg-green-950/20 rounded-md border border-green-200 dark:border-green-800">
                      <span className="text-base font-bold text-green-700 dark:text-green-300">{weightAdr}</span>
                      <span className="text-xs font-medium text-green-600 dark:text-green-400">%</span>
                    </div>
                  </div>

                  <div className="pt-4 border-t flex items-center justify-between gap-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      disabled={!strategy}
                      onClick={() => {
                        if (strategy) {
                          setWeightOccupancy(strategy.weightOccupancy)
                          setWeightCompetitor(strategy.weightCompetitor)
                        }
                      }}
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      保存済みの値に戻す
                    </Button>
                    <Button size="sm" className="gap-2" disabled={savingWeights} onClick={() => handleSaveWeights()}>
                      {savingWeights ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      設定を保存
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {/* サマリーカードを横並びに */}
          {loading ? (
            <div className="grid grid-cols-4 gap-3 border-t pt-2.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-3 border-t pt-2.5">
              <div className="flex flex-col">
                <p className="text-xs text-muted-foreground mb-0.5">実績ADR平均（本日まで）</p>
                <div className="text-lg font-semibold mb-0.5">{yen(overallSummary.currentAdr)}</div>
              </div>
              <div className="flex flex-col">
                <p className="text-xs text-muted-foreground mb-0.5">当月AI着地予測ADR</p>
                <div className="text-lg font-semibold mb-0.5">{yen(overallSummary.landingAdr)}</div>
              </div>
              <div className="flex flex-col">
                <p className="text-xs text-muted-foreground mb-0.5">実績RevPAR平均（本日まで）</p>
                <div className="text-lg font-semibold mb-0.5">{yen(overallSummary.currentRevPar)}</div>
                <div className="text-xs text-muted-foreground">稼働率: {pct(overallSummary.currentOccupancy)}</div>
              </div>
              <div className="flex flex-col">
                <p className="text-xs text-muted-foreground mb-0.5">当月AI着地予測RevPAR</p>
                <div className="text-lg font-semibold mb-0.5">{yen(overallSummary.landingRevPar)}</div>
                <div className="text-xs text-muted-foreground">稼働率予測: {pct(overallSummary.landingOccupancy)}</div>
              </div>
            </div>
          )}

          <div className="border-t my-4"></div>

          {loading ? (
            <Skeleton className="h-96 w-full" />
          ) : (
            monthsData.map((monthData, monthIndex) => {
              const days = monthData.calendar
              const chartData = days.map((d) => {
                const [, , dayNum] = d.date.split("-")
                return {
                  date: `${monthData.month}/${Number(dayNum)}`,
                  actualAdr: d.actualAdr,
                  predictedAdr: d.predictedAdr,
                  predictedOccupancy: d.predictedOccupancy != null ? Math.round(d.predictedOccupancy * 1000) / 10 : null,
                }
              })

              return (
                <div key={`${monthData.year}-${monthData.month}`} className="space-y-3">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-semibold">
                      日別価格カレンダー（{monthLabelOf(monthData.year, monthData.month)}）
                    </h3>
                    <div className="flex items-center gap-2">
                      <Button
                        variant={calendarViewMode === "table" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setCalendarViewMode("table")}
                      >
                        <Table2 className="w-4 h-4 mr-2" />
                        ADRテーブル
                      </Button>
                      <Button
                        variant={calendarViewMode === "grid" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setCalendarViewMode("grid")}
                      >
                        <Calendar className="w-4 h-4 mr-2" />
                        販売価格カレンダー
                      </Button>
                    </div>
                  </div>

                  {days.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-8 text-center">この月のデータがありません。</p>
                  ) : calendarViewMode === "table" ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-3 px-4 font-medium">日付</th>
                            <th className="text-left py-3 px-4 font-medium">曜日</th>
                            <th className="text-right py-3 px-4 font-medium">推奨価格(1名)</th>
                            <th className="text-center py-3 px-4 font-medium">
                              <TooltipProvider>
                                <UITooltip>
                                  <TooltipTrigger asChild>
                                    <span className="flex items-center justify-center gap-1 cursor-help">
                                      料金ランク
                                      <Info className="w-3.5 h-3.5 text-muted-foreground" />
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="max-w-xs">
                                    <p className="text-xs">推奨価格に対応する料金表ランク（R01〜R40）です。</p>
                                  </TooltipContent>
                                </UITooltip>
                              </TooltipProvider>
                            </th>
                            <th className="text-right py-3 px-4 font-medium">稼働率予測</th>
                            <th className="text-right py-3 px-4 font-medium">需要予測</th>
                            <th className="text-right py-3 px-4 font-medium">競合平均</th>
                            <th className="text-center py-3 px-4 font-medium">ステータス</th>
                          </tr>
                        </thead>
                        <tbody>
                          {days.map((day) => {
                            const [, , dayNum] = day.date.split("-")
                            const dow = new Date(day.date).getDay()
                            const status = statusLabel(day.demandLevel)
                            return (
                              <tr
                                key={day.date}
                                className="border-b hover:bg-muted/50 cursor-pointer transition-colors"
                                onClick={() => setSelectedRowForAnalysis({ monthIndex, day })}
                              >
                                <td className="py-3 px-4 font-medium">
                                  {monthData.month}/{Number(dayNum)}
                                </td>
                                <td className="py-3 px-4">{DAY_NAMES[dow]}</td>
                                <td className="text-right py-3 px-4 font-semibold">{yen(day.recommendedPrice)}</td>
                                <td className="text-center py-3 px-4">
                                  {day.rankLabel ? (
                                    <Badge className={`${getRankBadgeColor(day.recommendedRank ?? 0)} text-xs font-bold px-2`}>
                                      {day.rankLabel}
                                    </Badge>
                                  ) : (
                                    <span className="text-muted-foreground text-xs">-</span>
                                  )}
                                </td>
                                <td className="text-right py-3 px-4">{pct(day.predictedOccupancy)}</td>
                                <td className="text-right py-3 px-4">
                                  {day.demandLevel ? (
                                    <Badge className={`${demandBadgeClass(day.demandLevel)} text-xs`}>{day.demandLevel}</Badge>
                                  ) : (
                                    "-"
                                  )}
                                </td>
                                <td className="text-right py-3 px-4">{yen(day.competitorAvgPrice)}</td>
                                <td className="text-center py-3 px-4">
                                  <Badge variant={status.variant}>{status.label}</Badge>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <PriceGrid
                      year={monthData.year}
                      month={monthData.month}
                      days={days}
                      eventInfoMap={eventInfoMap}
                      onSelectDay={(day) => setSelectedDay({ monthIndex, day })}
                    />
                  )}

                  {/* 価格推移グラフ */}
                  <div className="mt-6 pt-6 border-t">
                    <h3 className="text-base font-semibold mb-3">価格推移グラフ</h3>
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 text-xs flex-wrap">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-0.5 bg-blue-600"></div>
                          <span>実績ADR</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-0.5 bg-green-600"></div>
                          <span>AI予測ADR</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 bg-orange-200 rounded"></div>
                          <span>稼働率予測</span>
                        </div>
                      </div>

                      <ResponsiveContainer width="100%" height={250}>
                        <ComposedChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                          <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.5} />
                          <YAxis
                            yAxisId="left"
                            tick={{ fontSize: 11 }}
                            stroke="currentColor"
                            opacity={0.5}
                            tickFormatter={(value) => `¥${(value / 1000).toFixed(0)}k`}
                          />
                          <YAxis
                            yAxisId="right"
                            orientation="right"
                            tick={{ fontSize: 11 }}
                            stroke="currentColor"
                            opacity={0.5}
                            tickFormatter={(value) => `${value}%`}
                          />
                          <Tooltip content={<PricingTooltip />} />
                          <Legend wrapperStyle={{ fontSize: "11px" }} />
                          <Bar yAxisId="right" dataKey="predictedOccupancy" fill="#fed7aa" opacity={0.5} name="稼働率予測" />
                          <Line yAxisId="left" type="monotone" dataKey="actualAdr" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} name="実績ADR" connectNulls={false} />
                          <Line yAxisId="left" type="monotone" dataKey="predictedAdr" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} name="AI予測ADR" connectNulls={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      {/* 当月のイベント情報（実API接続 — F-DP-07） */}
      <Card>
        <CardContent className="py-2.5 px-3">
          <div className="flex items-center justify-between mb-2.5">
            <div>
              <h3 className="text-lg font-semibold">当月のイベント情報</h3>
              <p className="text-xs text-muted-foreground mt-0.5">近隣イベントは需要予測の参考情報として登録されます</p>
            </div>
            <Dialog
              open={isEventDialogOpen}
              onOpenChange={(open) => {
                setIsEventDialogOpen(open)
                if (!open) resetNewEventForm()
              }}
            >
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-2">
                  <Plus className="w-3.5 h-3.5" />
                  イベントを追加
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle className="text-lg font-semibold">イベント登録</DialogTitle>
                  <DialogDescription className="text-sm">
                    近隣で開催されるイベント情報を登録します。
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <Label htmlFor="new-event-name">イベント名</Label>
                    <input
                      id="new-event-name"
                      value={newEventName}
                      onChange={(e) => setNewEventName(e.target.value)}
                      placeholder="例：○○フェスティバル"
                      className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="new-event-type">種別</Label>
                      <Select value={newEventType} onValueChange={setNewEventType}>
                        <SelectTrigger id="new-event-type" className="h-9 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {EVENT_TYPE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="new-event-impact">影響度</Label>
                      <Select value={newEventImpact} onValueChange={(v: "high" | "medium" | "low") => setNewEventImpact(v)}>
                        <SelectTrigger id="new-event-impact" className="h-9 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="high">高</SelectItem>
                          <SelectItem value="medium">中</SelectItem>
                          <SelectItem value="low">低</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="new-event-start">開始日</Label>
                      <input
                        id="new-event-start"
                        type="date"
                        value={newEventStart}
                        onChange={(e) => setNewEventStart(e.target.value)}
                        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="new-event-end">終了日</Label>
                      <input
                        id="new-event-end"
                        type="date"
                        value={newEventEnd}
                        onChange={(e) => setNewEventEnd(e.target.value)}
                        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-event-location">開催場所（任意）</Label>
                    <input
                      id="new-event-location"
                      value={newEventLocation}
                      onChange={(e) => setNewEventLocation(e.target.value)}
                      placeholder="例：○○ホール"
                      className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2 border-t">
                  <Button variant="outline" size="sm" onClick={() => setIsEventDialogOpen(false)}>
                    キャンセル
                  </Button>
                  <Button size="sm" className="gap-2" disabled={savingEvent} onClick={handleCreateEvent}>
                    {savingEvent ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    登録
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {eventsLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : eventsError ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <AlertCircle className="w-6 h-6 text-destructive" />
              <p className="text-sm text-muted-foreground">{eventsError}</p>
              <Button variant="outline" size="sm" onClick={loadEvents} className="gap-2">
                <RefreshCw className="w-4 h-4" />
                再試行
              </Button>
            </div>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">この期間のイベント情報は登録されていません。</p>
          ) : (
            <div className="space-y-2">
              {events.map((ev) => (
                <div key={ev.id} className="flex items-center justify-between gap-3 border rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{ev.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {eventTypeLabel(ev.type)}
                      </Badge>
                      {ev.expectedImpact && (
                        <Badge className={`${impactBadgeClass(ev.expectedImpact)} text-[10px]`}>
                          {impactLabel(ev.expectedImpact)}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatEventRange(ev.startDate, ev.endDate)}
                      {ev.location ? ` ・ ${ev.location}` : ""}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteEvent(ev.id)}
                    disabled={deletingEventId === ev.id}
                  >
                    {deletingEventId === ev.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Date Details Dialog */}
      <Dialog
        open={selectedDay !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedDay(null)
            setIsEditingEventInfo(false)
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedDay &&
            (() => {
              const { day } = selectedDay
              const [y, m, d] = day.date.split("-").map(Number)
              const dow = new Date(day.date).getDay()
              const dateString = `${y}年${m}月${d}日（${DAY_NAMES[dow]}）`
              const savedInfo = eventInfoMap[day.date]

              const handleEditStart = () => {
                setEditingEventInfo(savedInfo?.eventInfo || "")
                setEditingExternalFactors(savedInfo?.externalFactors || "")
                setIsEditingEventInfo(true)
              }

              const handleSave = () => {
                setEventInfoMap((prev) => ({
                  ...prev,
                  [day.date]: {
                    eventInfo: editingEventInfo || undefined,
                    externalFactors: editingExternalFactors || undefined,
                  },
                }))
                setIsEditingEventInfo(false)
              }

              return (
                <>
                  <DialogHeader>
                    <DialogTitle>{dateString} の詳細情報</DialogTitle>
                    <DialogDescription>AIによる推奨価格・需要予測の詳細です</DialogDescription>
                  </DialogHeader>

                  <div className="space-y-6 mt-4">
                    <div className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">推奨価格（料金ランク {day.rankLabel ?? "-"}）</div>
                        {day.confidence != null && <Badge variant="outline" className="text-xs">信頼度 {(day.confidence * 100).toFixed(0)}%</Badge>}
                      </div>
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>1名料金：{yen(day.price1P)}</div>
                        <div>2名料金：{yen(day.price2P)}</div>
                        <div>3名料金：{yen(day.price3P)}</div>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm border-t pt-3">
                        <div>需要予測：{day.demandLevel ?? "-"}（{demandDescription(day.demandLevel)}）</div>
                        <div>稼働率予測：{pct(day.predictedOccupancy)}</div>
                        <div>競合平均価格：{yen(day.competitorAvgPrice)}</div>
                        <div>AI予測ADR：{yen(day.predictedAdr)}</div>
                        {day.actualAdr != null && <div>実績ADR：{yen(day.actualAdr)}</div>}
                        {day.actualOccupancy != null && <div>実績稼働率：{pct(day.actualOccupancy)}</div>}
                      </div>
                    </div>

                    <div className="space-y-3 border-t pt-4">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-base">イベント情報・外部要因情報</h3>
                        {!isEditingEventInfo && (
                          <Button variant="outline" size="sm" onClick={handleEditStart} className="gap-2">
                            <Edit2 className="w-4 h-4" />
                            編集
                          </Button>
                        )}
                      </div>

                      {isEditingEventInfo ? (
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="event-info">イベント情報</Label>
                            <Textarea
                              id="event-info"
                              placeholder="例：○○ホールで○○コンサート予定です"
                              value={editingEventInfo}
                              onChange={(e) => setEditingEventInfo(e.target.value)}
                              rows={3}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="external-factors">外部要因情報</Label>
                            <Textarea
                              id="external-factors"
                              placeholder="例：天候、交通機関の遅延、その他の要因"
                              value={editingExternalFactors}
                              onChange={(e) => setEditingExternalFactors(e.target.value)}
                              rows={3}
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button onClick={handleSave} className="gap-2">
                              <Save className="w-4 h-4" />
                              保存
                            </Button>
                            <Button variant="outline" onClick={() => setIsEditingEventInfo(false)}>
                              キャンセル
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2 text-sm">
                          {savedInfo?.eventInfo && (
                            <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                              <div className="font-medium mb-1">イベント情報</div>
                              <div className="text-muted-foreground">{savedInfo.eventInfo}</div>
                            </div>
                          )}
                          {savedInfo?.externalFactors && (
                            <div className="p-3 bg-orange-50 dark:bg-orange-950/20 rounded-lg">
                              <div className="font-medium mb-1">外部要因情報</div>
                              <div className="text-muted-foreground">{savedInfo.externalFactors}</div>
                            </div>
                          )}
                          {!savedInfo?.eventInfo && !savedInfo?.externalFactors && (
                            <div className="text-muted-foreground text-sm">イベント情報・外部要因情報は未設定です</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )
            })()}
        </DialogContent>
      </Dialog>

      {/* AI Analysis Dialog */}
      {selectedRowForAnalysis && (
        <Dialog open={selectedRowForAnalysis !== null} onOpenChange={(open) => !open && setSelectedRowForAnalysis(null)}>
          <DialogContent className="!max-w-[60vw] sm:!max-w-[60vw] max-h-[90vh] overflow-y-auto w-full">
            {(() => {
              const { monthIndex, day } = selectedRowForAnalysis
              const [y, m, d] = day.date.split("-").map(Number)
              const dow = new Date(day.date).getDay()
              const days = monthsData[monthIndex]?.calendar ?? []
              const dayIdx = days.findIndex((x) => x.date === day.date)
              const neighborStart = Math.max(0, dayIdx - 3)
              const neighbors = days.slice(neighborStart, dayIdx + 4)

              const insights: Array<{ type: string; title: string; content: string }> = []

              if (day.demandLevel === "A" || day.demandLevel === "B") {
                insights.push({
                  type: "positive",
                  title: "需要予測が高い",
                  content: `${m}月${d}日（${DAY_NAMES[dow]}）は需要予測が「${day.demandLevel}」です。稼働率予測${pct(day.predictedOccupancy)}を踏まえ、価格競争力を維持しつつ収益最大化が狙えます。`,
                })
              }
              if (day.demandLevel === "D" || day.demandLevel === "E") {
                insights.push({
                  type: "negative",
                  title: "需要と稼働率が低い",
                  content: `需要予測が「${day.demandLevel}」で、稼働率予測も${pct(day.predictedOccupancy)}と低水準です。価格引き下げや需要喚起策の検討を推奨します。`,
                })
              }
              if (day.competitorAvgPrice != null) {
                const diff = (day.recommendedPrice ?? 0) - day.competitorAvgPrice
                const diffPercent = day.competitorAvgPrice > 0 ? (diff / day.competitorAvgPrice) * 100 : 0
                insights.push({
                  type: "chart-2",
                  title: "競合分析",
                  content: `競合ホテルの平均価格は${yen(day.competitorAvgPrice)}で、推奨価格は${diff >= 0 ? "+" : ""}${diffPercent.toFixed(1)}%（${diff >= 0 ? "高め" : "低め"}）です。`,
                })
              }
              if (day.actualAdr != null && day.actualOccupancy != null) {
                insights.push({
                  type: "chart-2",
                  title: "実績データ",
                  content: `本日までの実績ADRは${yen(day.actualAdr)}、実績稼働率は${pct(day.actualOccupancy)}でした。`,
                })
              }

              return (
                <>
                  <DialogHeader>
                    <DialogTitle>
                      {y}年{m}月{d}日（{DAY_NAMES[dow]}）のAI分析
                    </DialogTitle>
                    <DialogDescription>需要予測・競合分析・価格最適化の提案を表示します</DialogDescription>
                  </DialogHeader>

                  <div className="space-y-6 mt-4">
                    {neighbors.length > 1 && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base">周辺日の推奨価格・稼働率予測</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="overflow-x-auto">
                            <div className="grid grid-flow-col auto-cols-[90px] gap-3 min-w-fit">
                              {neighbors.map((n) => {
                                const [, , nd] = n.date.split("-")
                                const ndow = new Date(n.date).getDay()
                                const isSelected = n.date === day.date
                                return (
                                  <div
                                    key={n.date}
                                    className={`p-3 border rounded-lg text-center ${isSelected ? "ring-2 ring-primary bg-primary/5" : ""}`}
                                  >
                                    <div className="text-xs text-muted-foreground mb-1.5">{DAY_NAMES[ndow]}</div>
                                    <div className={`text-base font-semibold mb-2 ${isSelected ? "text-primary" : ""}`}>{Number(nd)}</div>
                                    <div className="text-xs text-muted-foreground mb-1 break-words">{yen(n.recommendedPrice)}</div>
                                    <div className="text-xs text-muted-foreground break-words">{pct(n.predictedOccupancy)}</div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <Card className="border-primary/50 bg-primary/5">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm font-medium text-primary">推奨価格 & 料金ランク</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="text-2xl font-semibold text-primary">{yen(day.recommendedPrice)}</div>
                          <div className="flex items-center gap-2 mt-1">
                            {day.rankLabel && (
                              <Badge className={`${getRankBadgeColor(day.recommendedRank ?? 0)} text-sm font-bold`}>{day.rankLabel}</Badge>
                            )}
                          </div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm font-medium text-muted-foreground">稼働率予測</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="text-2xl font-semibold">{pct(day.predictedOccupancy)}</div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm font-medium text-muted-foreground">需要予測</CardTitle>
                        </CardHeader>
                        <CardContent>
                          {day.demandLevel ? (
                            <Badge className={`${demandBadgeClass(day.demandLevel)} text-lg px-3 py-1`}>{day.demandLevel}</Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                          <div className="text-xs text-muted-foreground mt-1">{demandDescription(day.demandLevel)}</div>
                        </CardContent>
                      </Card>

                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm font-medium text-muted-foreground">競合平均価格</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="text-2xl font-semibold">{yen(day.competitorAvgPrice)}</div>
                        </CardContent>
                      </Card>
                    </div>

                    {insights.length > 0 && (
                      <Card className="border-l-4 border-l-primary">
                        <CardHeader>
                          <CardTitle className="text-lg flex items-center gap-2">
                            <AlertCircle className="w-5 h-5" />
                            AI分析インサイト
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {insights.map((insight, index) => (
                            <div key={index} className="flex items-start gap-3">
                              <div
                                className={`w-2 h-2 rounded-full mt-2 ${
                                  insight.type === "positive"
                                    ? "bg-[color:var(--positive)]"
                                    : insight.type === "negative"
                                      ? "bg-[color:var(--negative)]"
                                      : "bg-[color:var(--chart-2)]"
                                }`}
                              />
                              <div className="flex-1">
                                <div className="font-medium text-sm mb-1">{insight.title}</div>
                                <p className="text-sm leading-relaxed text-muted-foreground">{insight.content}</p>
                              </div>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </>
              )
            })()}
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function PriceGrid({
  year,
  month,
  days,
  eventInfoMap,
  onSelectDay,
}: {
  year: number
  month: number
  days: PricingCalendarDay[]
  eventInfoMap: Record<string, { eventInfo?: string; externalFactors?: string }>
  onSelectDay: (day: PricingCalendarDay) => void
}) {
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days])
  const firstDay = new Date(year, month - 1, 1)
  const daysInMonth = new Date(year, month, 0).getDate()
  const startDayOfWeek = firstDay.getDay()
  const prevMonthDays = new Date(year, month - 1, 0).getDate()
  const weeks = Math.ceil((daysInMonth + startDayOfWeek) / 7)

  const cells: Array<{ date: number; isCurrentMonth: boolean; dayOfWeek: number; data?: PricingCalendarDay }> = []

  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    cells.push({ date: prevMonthDays - i, isCurrentMonth: false, dayOfWeek: (i + 7 - startDayOfWeek) % 7 })
  }
  for (let date = 1; date <= daysInMonth; date++) {
    const key = `${year}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`
    const dow = (startDayOfWeek + date - 1) % 7
    cells.push({ date, isCurrentMonth: true, dayOfWeek: dow, data: byDate.get(key) })
  }
  const remaining = weeks * 7 - cells.length
  for (let date = 1; date <= remaining; date++) {
    cells.push({ date, isCurrentMonth: false, dayOfWeek: (cells.length) % 7 })
  }

  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        <div className="grid grid-cols-7 gap-px border-b mb-1">
          {DAY_NAMES.map((day) => (
            <div key={day} className="text-center py-2 text-sm font-medium">
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px border">
          {cells.map((cell, index) => {
            const key = `${year}-${String(month).padStart(2, "0")}-${String(cell.date).padStart(2, "0")}-${index}`
            const info = cell.isCurrentMonth
              ? eventInfoMap[`${year}-${String(month).padStart(2, "0")}-${String(cell.date).padStart(2, "0")}`]
              : undefined
            return (
              <div
                key={key}
                onClick={() => cell.isCurrentMonth && cell.data && onSelectDay(cell.data)}
                className={`
                  min-h-[100px] p-2 text-xs relative
                  ${cell.isCurrentMonth ? "" : "opacity-30"}
                  ${cell.dayOfWeek === 0 ? "bg-red-50 dark:bg-red-950/20" : cell.dayOfWeek === 6 ? "bg-blue-50 dark:bg-blue-950/20" : ""}
                  border-r border-b
                  ${cell.isCurrentMonth && cell.data ? "cursor-pointer hover:bg-muted/50 transition-colors" : ""}
                `}
              >
                <div
                  className={`font-medium mb-1 inline-flex items-center justify-center ${
                    cell.dayOfWeek === 0 ? "text-red-600 dark:text-red-400" : cell.dayOfWeek === 6 ? "text-blue-600 dark:text-blue-400" : ""
                  }`}
                >
                  {cell.date}
                </div>

                {info && (info.eventInfo || info.externalFactors) && (
                  <div className="mb-1">
                    <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">
                      {(info.eventInfo ? "イベント" : "") + (info.eventInfo && info.externalFactors ? "・" : "") + (info.externalFactors ? "要因" : "")}
                    </Badge>
                  </div>
                )}

                {cell.isCurrentMonth && cell.data ? (
                  <div className="space-y-0.5 text-[10px] leading-tight mt-1">
                    <div>1P-{cell.data.price1P?.toLocaleString() ?? "-"}</div>
                    <div>2P-{cell.data.price2P?.toLocaleString() ?? "-"}</div>
                    <div>3P-{cell.data.price3P?.toLocaleString() ?? "-"}</div>
                  </div>
                ) : cell.isCurrentMonth ? (
                  <div className="text-[10px] text-muted-foreground mt-1">データなし</div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
