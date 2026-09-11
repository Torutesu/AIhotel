"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertCircle, Table2, Calendar, Edit2, Save, Info, RefreshCw, Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Bar, ComposedChart, Legend } from "recharts"
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

import { useAuth } from "@/components/auth-provider"
import { api, ApiClientError, type PricingCalendarDay, type CreateEventInput } from "@/lib/api"
import type { Event as HotelEvent } from "@shared/types"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { StrategyWeightsCard } from "@/components/pricing/strategy-weights-card"
import { LandingForecastSummary } from "@/components/pricing/landing-forecast-summary"
import { DAY_NAMES, monthRange, parseMonthStr, toDateStr, monthLabel as monthLabelOf } from "@/lib/date"
import { useWeekend } from "@/hooks/use-weekend"
import { toNumber, type ChartTooltipEntry, type ChartTooltipProps } from "@/lib/chart-tooltip"

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
      return "bg-negative text-white"
    case "medium":
      return "bg-warning text-white"
    case "low":
      return "bg-primary text-white"
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

// 料金ランクのバッジカラー（バックエンドは40段階でランクを管理 — backend/prisma/seed.ts の PRICE_RANK_COUNT）
const PRICE_RANK_COUNT = 40
function getRankBadgeColor(rank: number): string {
  const band = Math.ceil((rank / PRICE_RANK_COUNT) * 5)
  if (band <= 1) return "bg-primary text-white"
  if (band <= 2) return "bg-[color:var(--chart-2)] text-white"
  if (band <= 3) return "bg-[color:var(--chart-4)] text-white"
  if (band <= 4) return "bg-warning text-white"
  return "bg-negative text-white"
}

function demandBadgeClass(demand: string | null): string {
  switch (demand) {
    case "A":
      return "bg-primary text-white"
    case "B":
      return "bg-[color:var(--cyan-edge)] text-white"
    case "C":
      return "bg-secondary text-secondary-foreground"
    case "D":
      return "bg-warning/15 text-warning"
    case "E":
      return "bg-negative/15 text-negative"
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

// 固定日の祝日（モックアップ用の簡易判定。移動祝日は含まない）
const FIXED_HOLIDAYS: Record<string, string> = {
  "1-1": "元日",
  "2-11": "建国記念の日",
  "2-23": "天皇誕生日",
  "4-29": "昭和の日",
  "5-3": "憲法記念日",
  "5-4": "みどりの日",
  "5-5": "こどもの日",
  "8-11": "山の日",
  "11-3": "文化の日",
  "11-23": "勤労感謝の日",
}

function holidayNameOf(date: Date): string | null {
  return FIXED_HOLIDAYS[`${date.getMonth() + 1}-${date.getDate()}`] ?? null
}

// 特日（お盆・年末年始・GW等の高需要期。AIが候補を提示し、オペレーターがマスタ設定画面で修正する想定）
function specialDayNameOf(date: Date): string | null {
  const m = date.getMonth() + 1
  const d = date.getDate()
  if (m === 8 && d >= 13 && d <= 16) return "お盆"
  if ((m === 12 && d >= 29) || (m === 1 && d <= 3)) return "年末年始"
  if ((m === 4 && d >= 29) || (m === 5 && d <= 5)) return "GW"
  return null
}

// 現在ADR・現在料金ランク（サイトコントローラー値のモック。日付から決定的に導出）
function mockCurrentAdr(day: PricingCalendarDay): number | null {
  if (day.predictedAdr == null) return null
  const dayNum = Number(day.date.split("-")[2])
  const factor = 0.94 + ((dayNum * 7) % 10) / 100
  return Math.round((day.predictedAdr * factor) / 10) * 10
}

function mockCurrentRank(day: PricingCalendarDay): number | null {
  if (day.recommendedRank == null) return null
  const dayNum = Number(day.date.split("-")[2])
  return Math.min(PRICE_RANK_COUNT, Math.max(1, day.recommendedRank + ((dayNum % 3) - 1)))
}

function rankLabelOf(rank: number): string {
  return `R${String(rank).padStart(2, "0")}`
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

function signedYen(value: number | null | undefined): string {
  if (value == null) return "-"
  return `${value >= 0 ? "+" : "-"}¥${Math.abs(Math.round(value)).toLocaleString()}`
}

function signedPt(value: number | null | undefined): string {
  if (value == null) return "-"
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}pt`
}

// 部屋タイプ・部屋タイプグループの選択肢（マスタ設定に相当するモック定義。先頭がデフォルト表示）
const ROOM_TYPES = [
  { value: "standard", label: "スタンダード", priceFactor: 1.0 },
  { value: "deluxe", label: "デラックス", priceFactor: 1.35 },
  { value: "suite", label: "スイート", priceFactor: 1.9 },
]

const ROOM_TYPE_GROUPS = [
  { value: "group-standard", label: "スタンダード系グループ" },
  { value: "group-premium", label: "プレミアム系グループ" },
]

// AI価格最適化の提案（モック。レベルを色付きバッジで表示）
const AI_PRICING_PROPOSALS: Array<{ level: "high" | "medium" | "low"; text: string }> = [
  {
    level: "high",
    text: "週末の需要が高まる見込みです。金曜日から日曜日にかけて段階的な価格引き上げを推奨します（平均+12%の増収見込み）。",
  },
  {
    level: "medium",
    text: "平日の稼働率向上のため、月曜日から木曜日の価格を5%引き下げることで、稼働率を15%向上できる見込みです。",
  },
  {
    level: "low",
    text: "競合ホテルの価格動向を監視中です。現在の価格設定は市場平均より2.5%高く、品質優位性を考慮すると適正範囲内です。",
  },
]

const PROPOSAL_LEVEL_STYLE: Record<string, { label: string; className: string }> = {
  high: { label: "レベル高", className: "bg-negative text-white" },
  medium: { label: "レベル中", className: "bg-warning text-white" },
  low: { label: "レベル低", className: "bg-primary text-white" },
}

interface MonthCalendar {
  year: number
  month: number
  calendar: PricingCalendarDay[]
}

interface PricingTabProps {
  /** 日別分析から遷移してきた際に開く対象日 */
  focusDate?: Date | null
  /** 対象日への遷移処理が完了したことを親に伝える */
  onFocusDateHandled?: () => void
}

export function PricingTab({ focusDate, onFocusDateHandled }: PricingTabProps = {}) {
  const { hotelId } = useAuth()
  // 週末の定義は Hotel.weekendDays が唯一の出所（U-6）
  const { isWeekendDow } = useWeekend()

  const now = new Date()
  const [targetMonth, setTargetMonth] = useState(() =>
    focusDate
      ? `${focusDate.getFullYear()}-${String(focusDate.getMonth() + 1).padStart(2, "0")}`
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  )
  // 日別分析から遷移してきた日（該当行をハイライトする）
  const [highlightedDate, setHighlightedDate] = useState<string | null>(
    focusDate ? toDateStr(focusDate) : null
  )
  const [roomType, setRoomType] = useState("all")
  const [calendarViewMode, setCalendarViewMode] = useState<"table" | "grid">("table")
  // タイプ別人数別カレンダーの表示タイプ（全タイプ表示なし。デフォルトはマスタの先頭タイプ）
  const [gridRoomType, setGridRoomType] = useState(ROOM_TYPES[0].value)

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
  // 編集中のイベント（null なら新規登録 — U-3）
  const [editingEvent, setEditingEvent] = useState<HotelEvent | null>(null)
  const [savingEvent, setSavingEvent] = useState(false)
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null)
  // 削除確認ダイアログの対象イベント（F-5）
  const [eventPendingDelete, setEventPendingDelete] = useState<HotelEvent | null>(null)
  const [newEventName, setNewEventName] = useState("")
  const [newEventType, setNewEventType] = useState("concert")
  const [newEventStart, setNewEventStart] = useState("")
  const [newEventEnd, setNewEventEnd] = useState("")
  const [newEventImpact, setNewEventImpact] = useState<"high" | "medium" | "low">("medium")
  const [newEventLocation, setNewEventLocation] = useState("")

  // 日別分析から日付付きで遷移してきたら、その月に切り替えて該当行をハイライトする
  useEffect(() => {
    if (!focusDate) return
    setTargetMonth(`${focusDate.getFullYear()}-${String(focusDate.getMonth() + 1).padStart(2, "0")}`)
    setHighlightedDate(toDateStr(focusDate))
    onFocusDateHandled?.()
  }, [focusDate, onFocusDateHandled])

  const { year: selectedYear, month: selectedMonth } = useMemo(
    () => parseMonthStr(targetMonth),
    [targetMonth]
  )

  // 表示は1か月のみ（表示する月は「対象月」で選択）
  const range = useMemo(() => monthRange(selectedYear, selectedMonth), [selectedYear, selectedMonth])

  const loadData = useCallback(async () => {
    if (!hotelId) return
    setLoading(true)
    setError(null)
    try {
      const calendar = await api.pricingCalendar(hotelId, selectedYear, selectedMonth)
      setMonthsData([{ year: calendar.year, month: calendar.month, calendar: calendar.calendar }])
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "データの取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId, selectedYear, selectedMonth])

  useEffect(() => {
    loadData()
  }, [loadData])

  const loadEvents = useCallback(async () => {
    if (!hotelId) return
    setEventsLoading(true)
    setEventsError(null)
    try {
      const result = await api.events(hotelId, range.startDate, range.endDate)
      setEvents(result)
    } catch (err) {
      setEventsError(err instanceof ApiClientError ? err.message : "イベント情報の取得に失敗しました")
    } finally {
      setEventsLoading(false)
    }
  }, [hotelId, range])

  useEffect(() => {
    loadEvents()
  }, [loadEvents])

  const resetNewEventForm = useCallback(() => {
    setEditingEvent(null)
    setNewEventName("")
    setNewEventType("concert")
    setNewEventStart("")
    setNewEventEnd("")
    setNewEventImpact("medium")
    setNewEventLocation("")
  }, [])

  /** 既存イベントを登録ダイアログに読み込んで編集モードで開く（U-3） */
  const openEditEvent = useCallback((ev: HotelEvent) => {
    setEditingEvent(ev)
    setNewEventName(ev.name)
    setNewEventType(ev.type)
    setNewEventStart(toDateStr(new Date(ev.startDate)))
    setNewEventEnd(toDateStr(new Date(ev.endDate)))
    setNewEventImpact((ev.expectedImpact as "high" | "medium" | "low") ?? "medium")
    setNewEventLocation(ev.location ?? "")
    setIsEventDialogOpen(true)
  }, [])

  /** 新規登録（POST /events）と編集（PUT /events/:id）を同じフォームで処理する（U-3） */
  const handleSubmitEvent = useCallback(async () => {
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
        location: newEventLocation.trim() || undefined,
      }
      if (editingEvent) {
        const { hotelId: _hotelId, ...updateInput } = payload
        await api.updateEvent(editingEvent.id, hotelId, updateInput)
        toast.success("イベントを更新しました")
      } else {
        await api.createEvent(payload)
        toast.success("イベントを登録しました")
      }
      setIsEventDialogOpen(false)
      resetNewEventForm()
      await loadEvents()
    } catch (err) {
      toast.error(
        err instanceof ApiClientError
          ? err.message
          : editingEvent
            ? "イベントの更新に失敗しました"
            : "イベントの登録に失敗しました"
      )
    } finally {
      setSavingEvent(false)
    }
  }, [
    hotelId,
    editingEvent,
    newEventName,
    newEventType,
    newEventStart,
    newEventEnd,
    newEventImpact,
    newEventLocation,
    resetNewEventForm,
    loadEvents,
  ])

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

  // 現在値（実績が確定した日のみを集計した実データ）。
  // 着地予測は GET /pricing/simulation（LandingForecastSummary）が担当し、ここでは算出しない（U-2）。
  const currentPerformance = useMemo(() => {
    const actualDays = monthsData.flatMap((m) => m.calendar).filter((d) => d.actualAdr != null)
    return {
      adr: avg(actualDays.map((d) => d.actualAdr)),
      occupancy: avg(actualDays.map((d) => d.actualOccupancy)),
      revPar: avg(
        actualDays.map((d) =>
          d.actualAdr != null && d.actualOccupancy != null ? d.actualAdr * d.actualOccupancy : null
        )
      ),
    }
  }, [monthsData])

  const PricingTooltip = ({ active, payload }: ChartTooltipProps) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border border-border rounded-lg shadow-lg p-3">
          <p className="text-sm font-medium mb-2">{payload[0].payload?.date}</p>
          <div className="space-y-1">
            {payload.map((entry: ChartTooltipEntry, index: number) => {
              const name = String(entry.name ?? "")
              const value = toNumber(entry.value)
              return (
                <p key={index} className="text-xs flex items-center gap-2">
                  <span className="w-3 h-0.5" style={{ backgroundColor: entry.color }}></span>
                  <span>
                    {name}: {name.includes("価格") || name.includes("ADR") ? `¥${Math.round(value).toLocaleString()}` : `${Math.round(value)}%`}
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

      {/* AI価格最適化の提案（レベルを色付きバッジで表示） */}
      <Card className="bg-[color:var(--sky-wash)]/25 border-[color:var(--cyan-edge)]/40">
        <CardHeader className="pb-1">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <span className="text-xl">🤖</span>
            AI価格最適化の提案
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-2 text-sm leading-relaxed">
            {AI_PRICING_PROPOSALS.map((proposal, index) => {
              const style = PROPOSAL_LEVEL_STYLE[proposal.level]
              return (
                <div key={index} className="flex items-start gap-3">
                  <Badge className={`${style.className} text-[10px] px-1.5 mt-0.5 flex-shrink-0`}>{style.label}</Badge>
                  <p>{proposal.text}</p>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* 価格戦略の重み付け（U-1 — GET/PUT /pricing/strategy） */}
      <StrategyWeightsCard />

      {/* 価格設定パラメータとサマリーを1つのCardに統合 */}
      <Card>
        <CardContent className="py-2.5 px-3">
          {/* フィルターコントロール（表示は1か月のみ・表示月を選択） */}
          <div className="flex items-center gap-3 flex-wrap mb-2.5">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="target-month" className="text-xs whitespace-nowrap">表示月</Label>
              <input
                id="target-month"
                type="month"
                value={targetMonth}
                onChange={(e) => setTargetMonth(e.target.value)}
                className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <Label htmlFor="room-type" className="text-xs whitespace-nowrap">部屋タイプ</Label>
              <Select value={roomType} onValueChange={setRoomType}>
                <SelectTrigger id="room-type" className="h-8 w-48 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全タイプ</SelectItem>
                  <SelectGroup>
                    <SelectLabel>部屋タイプ</SelectLabel>
                    {ROOM_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>部屋タイプグループ</SelectLabel>
                    {ROOM_TYPE_GROUPS.map((g) => (
                      <SelectItem key={g.value} value={g.value}>
                        {g.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 着地予測（U-2 — GET /pricing/simulation / POST /pricing/recompute） */}
          <LandingForecastSummary
            year={selectedYear}
            month={selectedMonth}
            current={currentPerformance}
            currentLoading={loading}
            onRecomputed={loadData}
          />

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
                  <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
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
                        テーブル表示
                      </Button>
                      <Button
                        variant={calendarViewMode === "grid" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setCalendarViewMode("grid")}
                      >
                        <Calendar className="w-4 h-4 mr-2" />
                        タイプ別人数別カレンダー
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    曜日欄の色: <span className="text-negative font-medium">祝日</span> / <span className="text-warning font-medium">特日（お盆・年末年始等）</span>
                    。特日はAIが候補を提示し、オペレーターがマスタ設定画面で修正できます。
                  </p>

                  {days.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-8 text-center">この月のデータがありません。</p>
                  ) : calendarViewMode === "table" ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-2 px-2 font-medium">日付</th>
                            <th className="text-left py-2 px-2 font-medium">曜日</th>
                            <th className="text-center py-2 px-2 font-medium">
                              <TooltipProvider>
                                <UITooltip>
                                  <TooltipTrigger asChild>
                                    <span className="flex items-center justify-center gap-1 cursor-help">
                                      アラート
                                      <Info className="w-3.5 h-3.5 text-muted-foreground" />
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="max-w-xs">
                                    <p className="text-xs">需要水準のアラート（A: 需要が非常に高い 〜 E: 需要が非常に低い）です。</p>
                                  </TooltipContent>
                                </UITooltip>
                              </TooltipProvider>
                            </th>
                            <th className="text-right py-2 px-2 font-medium">現在ADR</th>
                            <th className="text-right py-2 px-2 font-medium">推奨ADR（AI）</th>
                            <th className="text-right py-2 px-2 font-medium">稼働率予測（AI）</th>
                            <th className="text-center py-2 px-2 font-medium">
                              現在料金ランク
                              <span className="block text-[10px] font-normal text-muted-foreground">（サイトコントローラー）</span>
                            </th>
                            <th className="text-center py-2 px-2 font-medium">推奨料金ランク（AI）</th>
                            <th className="text-right py-2 px-2 font-medium">ADR結果</th>
                            <th className="text-right py-2 px-2 font-medium">稼働率結果</th>
                            <th className="text-right py-2 px-2 font-medium">
                              <TooltipProvider>
                                <UITooltip>
                                  <TooltipTrigger asChild>
                                    <span className="flex items-center justify-end gap-1 cursor-help">
                                      推奨ADR差異
                                      <Info className="w-3.5 h-3.5 text-muted-foreground" />
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="max-w-xs">
                                    <p className="text-xs">実績と推奨値の差異です。AIの学習およびAIコメント（良かった・悪かった等）の材料になります。</p>
                                  </TooltipContent>
                                </UITooltip>
                              </TooltipProvider>
                            </th>
                            <th className="text-right py-2 px-2 font-medium">推奨稼働率差異</th>
                          </tr>
                        </thead>
                        <tbody>
                          {days.map((day) => {
                            const [, , dayNum] = day.date.split("-")
                            const dateObj = new Date(day.date)
                            const dow = dateObj.getDay()
                            const holiday = holidayNameOf(dateObj)
                            const special = specialDayNameOf(dateObj)
                            const isActualDay = day.actualAdr != null
                            const currentAdr = isActualDay ? day.actualAdr : mockCurrentAdr(day)
                            const currentRank = mockCurrentRank(day)
                            const adrDiff = day.actualAdr != null && day.predictedAdr != null ? day.actualAdr - day.predictedAdr : null
                            const occDiff =
                              day.actualOccupancy != null && day.predictedOccupancy != null
                                ? day.actualOccupancy - day.predictedOccupancy
                                : null
                            // 特日 > 祝日 > 週末（Hotel.weekendDays）の順で色付け（色のみで表現、特日は別色）
                            const dayColorClass = special
                              ? "text-warning font-semibold"
                              : holiday
                                ? "text-negative font-semibold"
                                : isWeekendDow(dow)
                                  ? "text-primary font-medium"
                                  : ""
                            return (
                              <tr
                                key={day.date}
                                // 日別分析から遷移してきた日は、行を強調して画面内へスクロールする
                                ref={
                                  day.date === highlightedDate
                                    ? (el) => el?.scrollIntoView({ block: "center" })
                                    : undefined
                                }
                                className={`border-b hover:bg-muted/50 cursor-pointer transition-colors ${
                                  day.date === highlightedDate ? "bg-primary/10 ring-1 ring-primary/40" : ""
                                }`}
                                onClick={() => setSelectedRowForAnalysis({ monthIndex, day })}
                              >
                                <td className="py-2 px-2 font-medium">
                                  {monthData.month}/{Number(dayNum)}
                                </td>
                                <td className={`py-2 px-2 ${dayColorClass}`}>
                                  {DAY_NAMES[dow]}
                                  {(special || holiday) && (
                                    <span className="block text-[9px] leading-tight">{special ?? holiday}</span>
                                  )}
                                </td>
                                <td className="text-center py-2 px-2">
                                  {day.demandLevel ? (
                                    <Badge className={`${demandBadgeClass(day.demandLevel)} text-xs`}>{day.demandLevel}</Badge>
                                  ) : (
                                    "-"
                                  )}
                                </td>
                                <td className="text-right py-2 px-2">{yen(currentAdr)}</td>
                                <td className="text-right py-2 px-2 font-semibold">{yen(day.predictedAdr)}</td>
                                <td className="text-right py-2 px-2">{pct(day.predictedOccupancy)}</td>
                                <td className="text-center py-2 px-2">
                                  {currentRank != null ? (
                                    <Badge variant="outline" className="text-xs font-bold px-2">
                                      {rankLabelOf(currentRank)}
                                    </Badge>
                                  ) : (
                                    <span className="text-muted-foreground text-xs">-</span>
                                  )}
                                </td>
                                <td className="text-center py-2 px-2">
                                  {day.rankLabel ? (
                                    <Badge className={`${getRankBadgeColor(day.recommendedRank ?? 0)} text-xs font-bold px-2`}>
                                      {day.rankLabel}
                                    </Badge>
                                  ) : (
                                    <span className="text-muted-foreground text-xs">-</span>
                                  )}
                                </td>
                                {/* 結果・差異は実績に変わった日のみ数値を表示 */}
                                <td className="text-right py-2 px-2">{isActualDay ? yen(day.actualAdr) : "-"}</td>
                                <td className="text-right py-2 px-2">{isActualDay ? pct(day.actualOccupancy) : "-"}</td>
                                <td
                                  className={`text-right py-2 px-2 ${
                                    adrDiff == null ? "" : adrDiff >= 0 ? "text-[color:var(--positive)]" : "text-[color:var(--negative)]"
                                  }`}
                                >
                                  {adrDiff != null ? signedYen(adrDiff) : "-"}
                                </td>
                                <td
                                  className={`text-right py-2 px-2 ${
                                    occDiff == null ? "" : occDiff >= 0 ? "text-[color:var(--positive)]" : "text-[color:var(--negative)]"
                                  }`}
                                >
                                  {occDiff != null ? signedPt(occDiff) : "-"}
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
                      roomType={gridRoomType}
                      onRoomTypeChange={setGridRoomType}
                      onSelectDay={(day) => setSelectedDay({ monthIndex, day })}
                    />
                  )}

                  {/* 価格推移グラフ */}
                  <div className="mt-6 pt-6 border-t">
                    <h3 className="text-base font-semibold mb-3">価格推移グラフ</h3>
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 text-xs flex-wrap">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-0.5 bg-positive"></div>
                          <span>実績ADR</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-0.5 bg-[color:var(--chart-2)]"></div>
                          <span>AI予測ADR</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 bg-warning/40 rounded"></div>
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
                <Button variant="outline" size="sm" className="h-8 text-xs gap-2" onClick={resetNewEventForm}>
                  <Plus className="w-3.5 h-3.5" aria-hidden />
                  イベントを追加
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle className="text-lg font-semibold">
                    {editingEvent ? "イベント編集" : "イベント登録"}
                  </DialogTitle>
                  <DialogDescription className="text-sm">
                    {editingEvent
                      ? "登録済みのイベント情報を編集します。"
                      : "近隣で開催されるイベント情報を登録します。"}
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                  <Button size="sm" className="gap-2" disabled={savingEvent} onClick={handleSubmitEvent}>
                    {savingEvent ? (
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                    ) : (
                      <Save className="w-4 h-4" aria-hidden />
                    )}
                    {editingEvent ? "更新" : "登録"}
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
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditEvent(ev)}
                      aria-label={`イベント「${ev.name}」を編集`}
                    >
                      <Edit2 className="w-4 h-4 text-muted-foreground" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEventPendingDelete(ev)}
                      disabled={deletingEventId === ev.id}
                      aria-label={`イベント「${ev.name}」を削除`}
                    >
                      {deletingEventId === ev.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                      ) : (
                        <Trash2 className="w-4 h-4 text-muted-foreground" aria-hidden />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* イベント削除の確認（F-5） */}
      <ConfirmDialog
        open={eventPendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setEventPendingDelete(null)
        }}
        title="イベントを削除しますか？"
        description={
          eventPendingDelete
            ? `「${eventPendingDelete.name}」を削除します。この操作は取り消せません。`
            : undefined
        }
        confirmLabel="削除する"
        onConfirm={() => {
          const target = eventPendingDelete
          setEventPendingDelete(null)
          if (target) void handleDeleteEvent(target.id)
        }}
      />

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
                    <DialogDescription>AIによる推奨価格・需要アラートの詳細です</DialogDescription>
                  </DialogHeader>

                  <div className="space-y-6 mt-4">
                    <div className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">推奨価格（料金ランク {day.rankLabel ?? "-"}）</div>
                        {day.confidence != null && <Badge variant="outline" className="text-xs">信頼度 {(day.confidence * 100).toFixed(0)}%</Badge>}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                        <div>1名料金：{yen(day.price1P)}</div>
                        <div>2名料金：{yen(day.price2P)}</div>
                        <div>3名料金：{yen(day.price3P)}</div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm border-t pt-3">
                        <div>アラート：{day.demandLevel ?? "-"}（{demandDescription(day.demandLevel)}）</div>
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
                            <div className="p-3 bg-primary/5 rounded-lg">
                              <div className="font-medium mb-1">イベント情報</div>
                              <div className="text-muted-foreground">{savedInfo.eventInfo}</div>
                            </div>
                          )}
                          {savedInfo?.externalFactors && (
                            <div className="p-3 bg-warning/10 rounded-lg">
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
          <DialogContent className="max-h-[90vh] overflow-y-auto w-full sm:!max-w-[90vw] lg:!max-w-[60vw]">
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
                  title: "需要水準が高い",
                  content: `${m}月${d}日（${DAY_NAMES[dow]}）はアラートが「${day.demandLevel}」です。稼働率予測${pct(day.predictedOccupancy)}を踏まえ、価格競争力を維持しつつ収益最大化が狙えます。`,
                })
              }
              if (day.demandLevel === "D" || day.demandLevel === "E") {
                insights.push({
                  type: "negative",
                  title: "需要と稼働率が低い",
                  content: `アラートが「${day.demandLevel}」で、稼働率予測も${pct(day.predictedOccupancy)}と低水準です。料金ランクの引き下げや需要喚起策の検討を推奨します。`,
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
                const adrDiff = day.predictedAdr != null ? day.actualAdr - day.predictedAdr : null
                insights.push({
                  type: "chart-2",
                  title: "実績データ",
                  content:
                    `本日までの実績ADRは${yen(day.actualAdr)}、実績稼働率は${pct(day.actualOccupancy)}でした。` +
                    (adrDiff != null ? `推奨ADRとの差異は${signedYen(adrDiff)}で、AIの学習・コメント材料として蓄積されます。` : ""),
                })
              }

              return (
                <>
                  <DialogHeader>
                    <DialogTitle>
                      {y}年{m}月{d}日（{DAY_NAMES[dow]}）のAI分析
                    </DialogTitle>
                    <DialogDescription>需要アラート・競合分析・価格最適化の提案を表示します</DialogDescription>
                  </DialogHeader>

                  <div className="space-y-6 mt-4">
                    {neighbors.length > 1 && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base font-medium">周辺日の推奨価格・稼働率予測</CardTitle>
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
                          <CardTitle className="text-sm font-medium text-muted-foreground">アラート</CardTitle>
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
                          <CardTitle className="text-base font-medium flex items-center gap-2">
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
  roomType,
  onRoomTypeChange,
  onSelectDay,
}: {
  year: number
  month: number
  days: PricingCalendarDay[]
  eventInfoMap: Record<string, { eventInfo?: string; externalFactors?: string }>
  roomType: string
  onRoomTypeChange: (value: string) => void
  onSelectDay: (day: PricingCalendarDay) => void
}) {
  const { isWeekendDow } = useWeekend()
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days])
  const firstDay = new Date(year, month - 1, 1)
  const daysInMonth = new Date(year, month, 0).getDate()
  const startDayOfWeek = firstDay.getDay()
  const prevMonthDays = new Date(year, month - 1, 0).getDate()
  const weeks = Math.ceil((daysInMonth + startDayOfWeek) / 7)

  const selectedType = ROOM_TYPES.find((t) => t.value === roomType) ?? ROOM_TYPES[0]
  const priceOf = (base: number | null | undefined): string => {
    if (base == null) return "-"
    return Math.round(base * selectedType.priceFactor).toLocaleString()
  }

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
    <div className="space-y-2">
      {/* 表示タイプ選択（全タイプ表示なし。デフォルトはマスタ先頭のタイプ。ランクは利用人数にかかわらず共通） */}
      <div className="flex items-center gap-1.5">
        <Label htmlFor="grid-room-type" className="text-xs whitespace-nowrap">表示タイプ</Label>
        <Select value={roomType} onValueChange={onRoomTypeChange}>
          <SelectTrigger id="grid-room-type" className="h-8 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROOM_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-[10px] text-muted-foreground ml-2">料金ランクは利用人数にかかわらず共通です</span>
      </div>

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
                    min-h-[110px] p-2 text-xs relative
                    ${cell.isCurrentMonth ? "" : "opacity-30"}
                    ${isWeekendDow(cell.dayOfWeek) ? "bg-primary/5" : ""}
                    border-r border-b
                    ${cell.isCurrentMonth && cell.data ? "cursor-pointer hover:bg-muted/50 transition-colors" : ""}
                  `}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div
                      className={`font-medium inline-flex items-center justify-center ${
                        isWeekendDow(cell.dayOfWeek) ? "text-primary" : ""
                      }`}
                    >
                      {cell.date}
                    </div>
                    {cell.isCurrentMonth && cell.data?.rankLabel && (
                      <Badge className={`${getRankBadgeColor(cell.data.recommendedRank ?? 0)} text-[9px] font-bold px-1 py-0 h-4`}>
                        {cell.data.rankLabel}
                      </Badge>
                    )}
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
                      <div>1名-{priceOf(cell.data.price1P)}</div>
                      <div>2名-{priceOf(cell.data.price2P)}</div>
                      <div>3名-{priceOf(cell.data.price3P)}</div>
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
    </div>
  )
}
