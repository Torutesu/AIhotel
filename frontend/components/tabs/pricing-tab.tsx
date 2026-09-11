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
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { AlertCircle, Table2, Calendar, Edit2, Save, Info, RefreshCw, Loader2, Plus, Trash2, Check, CloudRain, Sparkles, X } from "lucide-react"
import { toast } from "sonner"
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Bar, ComposedChart, Legend } from "recharts"
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

import { useAuth } from "@/components/auth-provider"
import {
  api,
  ApiClientError,
  type PricingCalendarDay,
  type CreateEventInput,
  type PricingDigest,
  type PricingStrategy,
  type UpdatePricingStrategyInput,
  type DailySignal,
  type HotelEvent,
  type EventCandidate,
  type EventImpact,
  type Venue,
} from "@/lib/api"

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
    case "negative":
      return "bg-secondary text-secondary-foreground"
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
    case "negative":
      return "需要減"
    default:
      return "影響度:不明"
  }
}

/** イベント候補の検出元ラベル（前年実績からの自動検出 / 会場ページからの抽出） */
function candidateSourceLabel(source?: string | null): string {
  switch (source) {
    case "detected":
      return "自動検出"
    case "extracted":
      return "会場ページ抽出"
    default:
      return "手動"
  }
}

/** Date | ISO文字列 を input[type=date] 用の "YYYY-MM-DD" に整形する */
function toInputDate(d: Date | string): string {
  const date = new Date(d)
  if (Number.isNaN(date.getTime())) return ""
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
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

function monthLabelOf(year: number, month: number): string {
  return `${year}年${month}月`
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

/** "YYYY-MM-DD" をローカル日付として解釈する（new Date(str) はUTC扱いになるため） */
function parseDateKey(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(y, m - 1, d)
}

/** "M/D（曜）" 形式 */
function formatMD(dateStr: string): string {
  const date = parseDateKey(dateStr)
  return `${date.getMonth() + 1}/${date.getDate()}（${DAY_NAMES[date.getDay()]}）`
}

/** 稼働率を整数%で表示 */
function pct0(value: number | null | undefined): string {
  if (value == null) return "-"
  return `${Math.round(value * 100)}%`
}

/** 稼働率への寄与（0.12 → "+12pt"、-0.04 → "−4pt"） */
function ptLabel(pt: number): string {
  const rounded = Math.round(pt * 100)
  return `${rounded >= 0 ? "+" : "−"}${Math.abs(rounded)}pt`
}

/** ランク単位の寄与（1.6 → "+1.6"、-2.4 → "−2.4"） */
function rankDeltaLabel(delta: number): string {
  return `${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}`
}

function deltaColorClass(value: number | null | undefined): string {
  if (value == null || value === 0) return "text-muted-foreground"
  return value > 0 ? "text-[color:var(--positive)]" : "text-[color:var(--negative)]"
}

const SPECIAL_PERIOD_LABELS: Record<NonNullable<DailySignal["holiday"]["specialPeriod"]>, string> = {
  gw: "ゴールデンウィーク",
  obon: "お盆",
  nenmatsu: "年末年始",
}

/** 祝日・連休シグナルの説明文 */
function describeHolidaySignal(h: DailySignal["holiday"]): string {
  const parts: string[] = []
  if (h.holidayName) parts.push(h.holidayName)
  if (h.specialPeriod) parts.push(SPECIAL_PERIOD_LABELS[h.specialPeriod])
  if (h.position !== "none" && h.blockLength >= 2) {
    const pos = h.position === "eve" ? "前日" : h.position === "within" ? "中日" : "最終日"
    parts.push(`${h.blockLength}連休の${pos}`)
  }
  if (h.isBridgeDay) parts.push("飛び石の平日")
  return parts.join(" ・ ")
}

/** 推奨の理由（需要の内訳・ランクの内訳・期待RevPAR・予測区間）。explanation が無い旧モデルの行では何も表示しない */
function RecommendationReason({
  day,
  canDecide,
  deciding,
  onAdopt,
}: {
  day: PricingCalendarDay
  canDecide: boolean
  deciding: boolean
  onAdopt: (day: PricingCalendarDay) => void
}) {
  const ex = day.explanation
  if (!ex) return null
  const revParDiff =
    day.expectedRevParRecommended != null && day.expectedRevParCurrent != null
      ? day.expectedRevParRecommended - day.expectedRevParCurrent
      : null
  const alreadyAdopted = day.currentRank != null && day.currentRank === day.recommendedRank

  return (
    <div className="border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="font-medium">推奨の理由</div>
          <p className="text-xs text-muted-foreground">
            モデル {ex.modelVersion} ・ {ex.asOfDate} 時点（{ex.leadDays}日前の予測）
          </p>
        </div>
        {canDecide && day.recommendedRank != null && (
          <Button size="sm" className="gap-2" disabled={deciding || alreadyAdopted} onClick={() => onAdopt(day)}>
            {deciding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {alreadyAdopted ? "採用済み" : `採用（${rankLabelOf(day.recommendedRank)}）`}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1.5">需要の内訳</div>
          <ul className="space-y-1.5">
            {ex.demandFactors.map((f) => (
              <li key={f.key} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div>{f.label}</div>
                  {f.detail && <div className="text-[11px] text-muted-foreground leading-snug">{f.detail}</div>}
                </div>
                <span className={`tabular-nums whitespace-nowrap ${f.key === "base" ? "font-medium" : deltaColorClass(f.pt)}`}>
                  {f.key === "base" ? `基準 ${Math.round(f.pt * 100)}%` : ptLabel(f.pt)}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2 pt-2 border-t flex items-center justify-between text-xs">
            <span className="text-muted-foreground">予測稼働率（制約前 {pct0(ex.unconstrainedOccupancy)}）</span>
            <span className="font-semibold">{pct0(ex.confidence.p50)}</span>
          </div>
        </div>

        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1.5">ランクの内訳</div>
          <ul className="space-y-1.5">
            {ex.priceContributions.map((c) => (
              <li key={c.key} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div>{c.label}</div>
                  {c.detail && <div className="text-[11px] text-muted-foreground leading-snug">{c.detail}</div>}
                </div>
                <span className={`tabular-nums whitespace-nowrap ${c.key === "base" ? "font-medium" : deltaColorClass(c.delta)}`}>
                  {c.key === "base" && c.rank != null ? rankLabelOf(c.rank) : c.delta != null ? rankDeltaLabel(c.delta) : "-"}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2 pt-2 border-t flex items-center justify-between text-xs">
            <span className="text-muted-foreground">最終ランク（収益最大 {rankLabelOf(ex.revenueOptimalRank)}）</span>
            <span className="font-semibold">{day.recommendedRank != null ? rankLabelOf(day.recommendedRank) : "-"}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm border-t pt-3">
        <div>
          <div>
            期待RevPAR：現在 {yen(day.expectedRevParCurrent)} → 推奨 {yen(day.expectedRevParRecommended)}
            {revParDiff != null && <span className={`ml-1 font-semibold ${deltaColorClass(revParDiff)}`}>（{signedYen(revParDiff)}）</span>}
          </div>
          <div className="text-[11px] text-muted-foreground">
            現在 = {rankLabelOf(ex.comparisonRank)}
            {day.currentRank != null ? "（採用中のランク）" : "（採用記録なしのため基準ランクと比較）"}
          </div>
        </div>
        <div>
          <div>
            予測稼働率区間：稼働率 {Math.round(ex.confidence.p10 * 100)}〜{Math.round(ex.confidence.p90 * 100)}%（中央 {Math.round(ex.confidence.p50 * 100)}%）
          </div>
          <div className="text-[11px] text-muted-foreground">推奨ランク適用時の期待稼働率 {pct0(ex.expectedOccupancyRecommended)}</div>
        </div>
      </div>
    </div>
  )
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

/** Date を "yyyy-MM-dd" に整形する（ローカル時刻基準） */
function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export function PricingTab({ focusDate, onFocusDateHandled }: PricingTabProps = {}) {
  const { hotelId, user } = useAuth()
  // 採否記録・戦略変更・天候取り込みは MANAGER 以上（バックエンドの requireRole と一致させる）
  const canDecide = user?.role === "ADMIN" || user?.role === "MANAGER"

  const now = new Date()
  const [targetMonth, setTargetMonth] = useState(() =>
    focusDate
      ? `${focusDate.getFullYear()}-${String(focusDate.getMonth() + 1).padStart(2, "0")}`
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  )
  // 日別分析から遷移してきた日（該当行をハイライトする）
  const [highlightedDate, setHighlightedDate] = useState<string | null>(
    focusDate ? toDateKey(focusDate) : null
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
  const [savingEvent, setSavingEvent] = useState(false)
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null)
  const [newEventName, setNewEventName] = useState("")
  const [newEventType, setNewEventType] = useState("concert")
  const [newEventStart, setNewEventStart] = useState("")
  const [newEventEnd, setNewEventEnd] = useState("")
  // "auto" = 会場の収容人数と距離からバックエンドが推定（expectedImpact を送らない）
  const [newEventImpact, setNewEventImpact] = useState<"high" | "medium" | "low" | "negative" | "auto">("medium")
  const [newEventLocation, setNewEventLocation] = useState("")
  const [newEventVenueId, setNewEventVenueId] = useState<string>("none")
  const [newEventAttendance, setNewEventAttendance] = useState("")

  // 会場マスタ（イベント登録時の選択肢。設定画面で管理）
  const [venues, setVenues] = useState<Venue[]>([])

  // イベント候補（前年実績からの自動検出・会場ページからの抽出 — 外部要因設計 Phase 2）
  const [candidates, setCandidates] = useState<EventCandidate[]>([])
  const [candidatesLoading, setCandidatesLoading] = useState(true)
  const [candidatesError, setCandidatesError] = useState<string | null>(null)
  const [detectingCandidates, setDetectingCandidates] = useState(false)
  const [reviewingCandidateId, setReviewingCandidateId] = useState<string | null>(null)
  const [approvingCandidate, setApprovingCandidate] = useState<EventCandidate | null>(null)
  const [approveName, setApproveName] = useState("")
  const [approveType, setApproveType] = useState("other")
  const [approveStart, setApproveStart] = useState("")
  const [approveEnd, setApproveEnd] = useState("")
  const [approveImpact, setApproveImpact] = useState<EventImpact>("medium")

  // 日別分析から日付付きで遷移してきたら、その月に切り替えて該当行をハイライトする
  useEffect(() => {
    if (!focusDate) return
    setTargetMonth(`${focusDate.getFullYear()}-${String(focusDate.getMonth() + 1).padStart(2, "0")}`)
    setHighlightedDate(toDateKey(focusDate))
    onFocusDateHandled?.()
  }, [focusDate, onFocusDateHandled])

  // 表示は1か月のみ（表示する月は「対象月」で選択）
  const monthRange = useMemo(() => {
    const [yearStr, monthStr] = targetMonth.split("-")
    const baseYear = Number.parseInt(yearStr, 10)
    const baseMonth = Number.parseInt(monthStr, 10)
    const start = new Date(baseYear, baseMonth - 1, 1)
    const end = new Date(baseYear, baseMonth, 0)
    return { startDate: toDateStr(start), endDate: toDateStr(end) }
  }, [targetMonth])

  const loadData = useCallback(async () => {
    if (!hotelId) return
    setLoading(true)
    setError(null)
    try {
      const [yearStr, monthStr] = targetMonth.split("-")
      const baseYear = Number.parseInt(yearStr, 10)
      const baseMonth = Number.parseInt(monthStr, 10)

      const calendar = await api.pricingCalendar(hotelId, baseYear, baseMonth)
      setMonthsData([{ year: calendar.year, month: calendar.month, calendar: calendar.calendar }])
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "データの取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId, targetMonth])

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

  // 会場マスタは登録ダイアログの選択肢にのみ使うため、取得失敗時は選択肢なしで続行する（登録自体は可能）
  useEffect(() => {
    if (!hotelId) return
    let cancelled = false
    api
      .venues(hotelId)
      .then((result) => {
        if (!cancelled) setVenues(result.filter((v) => v.isActive))
      })
      .catch(() => {
        if (!cancelled) setVenues([])
      })
    return () => {
      cancelled = true
    }
  }, [hotelId])

  const loadCandidates = useCallback(async () => {
    if (!hotelId) return
    setCandidatesLoading(true)
    setCandidatesError(null)
    try {
      setCandidates(await api.eventCandidates(hotelId))
    } catch (err) {
      setCandidatesError(err instanceof ApiClientError ? err.message : "イベント候補の取得に失敗しました")
    } finally {
      setCandidatesLoading(false)
    }
  }, [hotelId])

  useEffect(() => {
    loadCandidates()
  }, [loadCandidates])

  const resetNewEventForm = useCallback(() => {
    setNewEventName("")
    setNewEventType("concert")
    setNewEventStart("")
    setNewEventEnd("")
    setNewEventImpact("medium")
    setNewEventLocation("")
    setNewEventVenueId("none")
    setNewEventAttendance("")
  }, [])

  /** 会場を選ぶと影響度は「自動推定」に切り替える（手動で上書き可）。会場を外したら「中」に戻す */
  const handleSelectVenue = useCallback((venueId: string) => {
    setNewEventVenueId(venueId)
    setNewEventImpact((prev) => {
      if (venueId === "none") return prev === "auto" ? "medium" : prev
      return "auto"
    })
  }, [])

  const handleDetectCandidates = useCallback(async () => {
    if (!hotelId) return
    setDetectingCandidates(true)
    try {
      const result = await api.detectEventCandidates(hotelId)
      if (result.created > 0) {
        toast.success(`前年 ${result.analyzedDays} 日分を分析し、${result.created} 件の候補を追加しました`)
      } else {
        toast.info(
          `前年 ${result.analyzedDays} 日分を分析しました。新しい候補はありません` +
            (result.skippedExisting > 0 ? `（既存の候補 ${result.skippedExisting} 件はスキップ）` : "")
        )
      }
      await loadCandidates()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "イベント候補の検出に失敗しました")
    } finally {
      setDetectingCandidates(false)
    }
  }, [hotelId, loadCandidates])

  const openApproveDialog = useCallback((candidate: EventCandidate) => {
    setApprovingCandidate(candidate)
    setApproveName(candidate.name)
    setApproveType(EVENT_TYPE_OPTIONS.some((o) => o.value === candidate.type) ? candidate.type : "other")
    setApproveStart(toInputDate(candidate.startDate))
    setApproveEnd(toInputDate(candidate.endDate))
    setApproveImpact(candidate.expectedImpact ?? "medium")
  }, [])

  const handleApproveCandidate = useCallback(async () => {
    if (!hotelId || !approvingCandidate) return
    if (!approveName.trim() || !approveStart || !approveEnd) {
      toast.error("イベント名・期間を入力してください")
      return
    }
    if (approveStart > approveEnd) {
      toast.error("開始日は終了日以前にしてください")
      return
    }
    setReviewingCandidateId(approvingCandidate.id)
    try {
      await api.reviewEventCandidate(approvingCandidate.id, hotelId, {
        decision: "approve",
        name: approveName.trim(),
        type: approveType,
        startDate: approveStart,
        endDate: approveEnd,
        expectedImpact: approveImpact,
      })
      toast.success(`「${approveName.trim()}」を承認し、イベントとして登録しました`)
      setApprovingCandidate(null)
      // 承認されたイベントは需要予測に反映されるためカレンダーも取り直す
      await Promise.all([loadCandidates(), loadEvents(), loadData()])
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "イベント候補の承認に失敗しました")
    } finally {
      setReviewingCandidateId(null)
    }
  }, [hotelId, approvingCandidate, approveName, approveType, approveStart, approveEnd, approveImpact, loadCandidates, loadEvents, loadData])

  const handleRejectCandidate = useCallback(
    async (candidate: EventCandidate) => {
      if (!hotelId) return
      setReviewingCandidateId(candidate.id)
      try {
        await api.reviewEventCandidate(candidate.id, hotelId, { decision: "reject" })
        toast.success(`「${candidate.name}」を却下しました`)
        await loadCandidates()
      } catch (err) {
        toast.error(err instanceof ApiClientError ? err.message : "イベント候補の却下に失敗しました")
      } finally {
        setReviewingCandidateId(null)
      }
    },
    [hotelId, loadCandidates]
  )

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
    const attendance = newEventAttendance.trim() === "" ? null : Number(newEventAttendance)
    if (attendance != null && (!Number.isInteger(attendance) || attendance < 0)) {
      toast.error("見込み来場者数は0以上の整数で入力してください")
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
        // "auto" のときは送らず、会場の収容人数・距離からバックエンドに推定させる
        ...(newEventImpact !== "auto" && { expectedImpact: newEventImpact }),
        ...(newEventLocation.trim() && { location: newEventLocation.trim() }),
        ...(newEventVenueId !== "none" && { venueId: newEventVenueId }),
        ...(attendance != null && { expectedAttendance: attendance }),
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
  }, [
    hotelId,
    newEventName,
    newEventType,
    newEventStart,
    newEventEnd,
    newEventImpact,
    newEventLocation,
    newEventVenueId,
    newEventAttendance,
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

  // 今日決めるべき日（ダイジェスト — 外部要因設計 P0-5）
  const [digest, setDigest] = useState<PricingDigest | null>(null)
  const [digestLoading, setDigestLoading] = useState(true)
  const [digestError, setDigestError] = useState<string | null>(null)
  const [decidingDate, setDecidingDate] = useState<string | null>(null)

  // 価格戦略（重み付け＋ガードレール — F-DP-02 / 外部要因設計 P0-4）
  const [strategy, setStrategy] = useState<PricingStrategy | null>(null)
  const [strategyLoading, setStrategyLoading] = useState(true)
  const [strategyError, setStrategyError] = useState<string | null>(null)
  const [strategyForm, setStrategyForm] = useState<UpdatePricingStrategyInput>({
    weightOccupancy: 40,
    weightAdr: 40,
    weightCompetitor: 20,
    minRank: 1,
    maxRank: PRICE_RANK_COUNT,
    maxDailyRankChange: 3,
    competitorPositionPct: 0,
    autoAdopt: false,
    autoAdoptMinConfidence: 0.7,
    autoAdoptMaxLeadDays: 14,
  })
  const [savingStrategy, setSavingStrategy] = useState(false)

  // 外部シグナル（祝日・連休・天候 — 外部要因設計 P0-2 / P1-7）
  const [signals, setSignals] = useState<DailySignal[]>([])
  const [signalsLoading, setSignalsLoading] = useState(true)
  const [signalsError, setSignalsError] = useState<string | null>(null)
  const [ingestingSignals, setIngestingSignals] = useState(false)

  const loadDigest = useCallback(async () => {
    if (!hotelId) return
    setDigestLoading(true)
    setDigestError(null)
    try {
      setDigest(await api.pricingDigest(hotelId))
    } catch (err) {
      setDigestError(err instanceof ApiClientError ? err.message : "ダイジェストの取得に失敗しました")
    } finally {
      setDigestLoading(false)
    }
  }, [hotelId])

  useEffect(() => {
    loadDigest()
  }, [loadDigest])

  const loadStrategy = useCallback(async () => {
    if (!hotelId) return
    setStrategyLoading(true)
    setStrategyError(null)
    try {
      const result = await api.pricingStrategy(hotelId)
      setStrategy(result)
      setStrategyForm({
        weightOccupancy: result.weightOccupancy,
        weightAdr: result.weightAdr,
        weightCompetitor: result.weightCompetitor,
        minRank: result.minRank ?? 1,
        maxRank: result.maxRank ?? PRICE_RANK_COUNT,
        maxDailyRankChange: result.maxDailyRankChange ?? 3,
        competitorPositionPct: result.competitorPositionPct ?? 0,
        autoAdopt: result.autoAdopt ?? false,
        autoAdoptMinConfidence: result.autoAdoptMinConfidence ?? 0.7,
        autoAdoptMaxLeadDays: result.autoAdoptMaxLeadDays ?? 14,
      })
    } catch (err) {
      setStrategyError(err instanceof ApiClientError ? err.message : "価格戦略の取得に失敗しました")
    } finally {
      setStrategyLoading(false)
    }
  }, [hotelId])

  useEffect(() => {
    loadStrategy()
  }, [loadStrategy])

  const loadSignals = useCallback(async () => {
    if (!hotelId) return
    setSignalsLoading(true)
    setSignalsError(null)
    try {
      setSignals(await api.signals(hotelId, monthRange.startDate, monthRange.endDate))
    } catch (err) {
      setSignalsError(err instanceof ApiClientError ? err.message : "外部要因の取得に失敗しました")
    } finally {
      setSignalsLoading(false)
    }
  }, [hotelId, monthRange])

  useEffect(() => {
    loadSignals()
  }, [loadSignals])

  /** 推奨ランクの採否を記録し、カレンダーとダイジェストを再取得する */
  const handleDecide = useCallback(
    async (date: string, appliedRank: number, reason?: string) => {
      if (!hotelId) return
      setDecidingDate(date)
      try {
        await api.recordDecision({ hotelId, date, appliedRank, ...(reason && { reason }) })
        toast.success(
          reason === "据え置き"
            ? `${formatMD(date)} を ${rankLabelOf(appliedRank)} で据え置きました`
            : `${formatMD(date)} に ${rankLabelOf(appliedRank)} を採用しました`
        )
        await Promise.all([loadData(), loadDigest()])
      } catch (err) {
        toast.error(err instanceof ApiClientError ? err.message : "採否の記録に失敗しました")
      } finally {
        setDecidingDate(null)
      }
    },
    [hotelId, loadData, loadDigest]
  )

  const setStrategyField = useCallback((key: Exclude<keyof UpdatePricingStrategyInput, "autoAdopt">, raw: string) => {
    const value = raw === "" ? Number.NaN : Number(raw)
    setStrategyForm((prev) => ({ ...prev, [key]: value }))
  }, [])

  const strategyWeightTotal =
    (strategyForm.weightOccupancy || 0) + (strategyForm.weightAdr || 0) + (strategyForm.weightCompetitor || 0)
  const strategyValidationError = useMemo(() => {
    const f = strategyForm
    const nums = [f.weightOccupancy, f.weightAdr, f.weightCompetitor, f.minRank, f.maxRank, f.maxDailyRankChange, f.competitorPositionPct]
    if (nums.some((n) => n == null || Number.isNaN(n))) return "すべての項目を数値で入力してください"
    if (strategyWeightTotal !== 100) return `重み付けの合計は100%にしてください（現在 ${strategyWeightTotal}%）`
    if (f.minRank! < 1 || f.maxRank! > PRICE_RANK_COUNT) return `ランクは1〜${PRICE_RANK_COUNT}の範囲で指定してください`
    if (f.minRank! > f.maxRank!) return "最小ランクは最大ランク以下にしてください"
    if (f.maxDailyRankChange! < 0) return "1回の最大変動幅は0以上にしてください"
    if (f.autoAdopt) {
      if (f.autoAdoptMinConfidence == null || Number.isNaN(f.autoAdoptMinConfidence) || f.autoAdoptMinConfidence < 0 || f.autoAdoptMinConfidence > 1)
        return "自動採用の最低信頼度は0〜1の範囲で指定してください"
      if (f.autoAdoptMaxLeadDays == null || Number.isNaN(f.autoAdoptMaxLeadDays) || f.autoAdoptMaxLeadDays < 0)
        return "自動採用の対象リードタイムは0日以上にしてください"
    }
    return null
  }, [strategyForm, strategyWeightTotal])

  const handleSaveStrategy = useCallback(async () => {
    if (!hotelId || strategyValidationError) return
    setSavingStrategy(true)
    try {
      const updated = await api.updatePricingStrategy(hotelId, {
        weightOccupancy: Math.round(strategyForm.weightOccupancy),
        weightAdr: Math.round(strategyForm.weightAdr),
        weightCompetitor: Math.round(strategyForm.weightCompetitor),
        minRank: Math.round(strategyForm.minRank!),
        maxRank: Math.round(strategyForm.maxRank!),
        maxDailyRankChange: Math.round(strategyForm.maxDailyRankChange!),
        competitorPositionPct: strategyForm.competitorPositionPct!,
        autoAdopt: strategyForm.autoAdopt ?? false,
        // 自動採用OFFで入力欄が空の場合は保存済みの値を維持する
        autoAdoptMinConfidence:
          strategyForm.autoAdoptMinConfidence != null && !Number.isNaN(strategyForm.autoAdoptMinConfidence)
            ? strategyForm.autoAdoptMinConfidence
            : strategy?.autoAdoptMinConfidence ?? 0.7,
        autoAdoptMaxLeadDays:
          strategyForm.autoAdoptMaxLeadDays != null && !Number.isNaN(strategyForm.autoAdoptMaxLeadDays)
            ? Math.round(strategyForm.autoAdoptMaxLeadDays)
            : strategy?.autoAdoptMaxLeadDays ?? 14,
      })
      setStrategy(updated)
      toast.success("価格戦略を保存しました")
      // 重み・ガードレールは推奨ランクに影響するため再計算結果を取り直す
      await Promise.all([loadData(), loadDigest()])
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "価格戦略の保存に失敗しました")
    } finally {
      setSavingStrategy(false)
    }
  }, [hotelId, strategyForm, strategy, strategyValidationError, loadData, loadDigest])

  const handleIngestSignals = useCallback(async () => {
    if (!hotelId) return
    setIngestingSignals(true)
    try {
      const result = await api.ingestSignals(hotelId)
      const counts: string[] = []
      if (result.jma) counts.push(`気象庁 ${result.jma.count}件${result.jma.fallbackAreaCode ? `（代替区域 ${result.jma.fallbackAreaCode}）` : ""}`)
      if (result.openMeteo) counts.push(`Open-Meteo ${result.openMeteo.count}件`)
      if (counts.length > 0) {
        toast.success(`天候予報を取り込みました（${counts.join(" / ")}）`)
      }
      if (result.skipped.length > 0) {
        toast.warning(`スキップ: ${result.skipped.join("、")}`)
      }
      if (counts.length === 0 && result.skipped.length === 0) {
        toast.info("取り込み対象の予報がありませんでした")
      }
      await loadSignals()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "天候予報の取り込みに失敗しました")
    } finally {
      setIngestingSignals(false)
    }
  }, [hotelId, loadSignals])

  // 当月の外部要因（連休・特別期間・雨天予報）
  const holidaySignals = useMemo(
    () => signals.filter((s) => (s.holiday.position !== "none" && s.holiday.blockHasHoliday) || s.holiday.specialPeriod != null),
    [signals]
  )
  const rainySignals = useMemo(() => signals.filter((s) => s.weather?.isRainy), [signals])

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

      {/* 今日決めるべき日（ダイジェスト — 外部要因設計 P0-5） */}
      <Card>
        <CardContent className="py-2.5 px-3">
          <div className="flex items-center justify-between mb-2.5 flex-wrap gap-2">
            <div>
              <h3 className="text-lg font-semibold">今日決めるべき日</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                推奨ランクと現在のランクが異なる日を、期待増収額の大きい順に表示します
                {digest ? `（${digest.asOfDate} 時点・客室数 ${digest.totalRooms}）` : ""}
                {!canDecide && "。採否の記録にはMANAGER以上の権限が必要です"}
              </p>
            </div>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-2" onClick={loadDigest} disabled={digestLoading}>
              <RefreshCw className={`w-3.5 h-3.5 ${digestLoading ? "animate-spin" : ""}`} />
              更新
            </Button>
          </div>

          {digestLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : digestError ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <AlertCircle className="w-6 h-6 text-destructive" />
              <p className="text-sm text-muted-foreground">{digestError}</p>
              <Button variant="outline" size="sm" onClick={loadDigest} className="gap-2">
                <RefreshCw className="w-4 h-4" />
                再試行
              </Button>
            </div>
          ) : !digest || digest.priorityDays.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">推奨と現在のランクが一致しています</p>
          ) : (
            <div className="space-y-2">
              {digest.priorityDays.map((p) => (
                <div key={p.date} className="flex items-center gap-3 border rounded-lg px-3 py-2 flex-wrap">
                  <div className="flex items-center gap-2 w-28 shrink-0">
                    <span className="font-medium text-sm">{formatMD(p.date)}</span>
                    {p.demandLevel ? (
                      <Badge className={`${demandBadgeClass(p.demandLevel)} text-xs`}>{p.demandLevel}</Badge>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1.5 text-sm shrink-0">
                    <span className="text-xs text-muted-foreground">現在</span>
                    <Badge variant="outline" className="text-xs font-bold px-2">
                      {rankLabelOf(p.comparisonRank)}
                    </Badge>
                    <span className="text-muted-foreground">→</span>
                    <span className="text-xs text-muted-foreground">推奨</span>
                    <Badge className={`${getRankBadgeColor(p.recommendedRank)} text-xs font-bold px-2`}>
                      {rankLabelOf(p.recommendedRank)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">（{yen(p.recommendedPrice)}）</span>
                  </div>
                  <div className={`text-sm font-semibold tabular-nums w-28 shrink-0 ${deltaColorClass(p.expectedRevenueDelta)}`}>
                    {signedYen(p.expectedRevenueDelta)}
                  </div>
                  <p className="text-xs text-muted-foreground flex-1 min-w-[160px]">
                    稼働率予測 {pct0(p.predictedOccupancy)} ・ {p.summary}
                  </p>
                  {canDecide && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        size="sm"
                        className="h-7 text-xs gap-1"
                        disabled={decidingDate != null}
                        onClick={() => handleDecide(p.date, p.recommendedRank)}
                      >
                        {decidingDate === p.date ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        採用
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={decidingDate != null}
                        onClick={() => handleDecide(p.date, p.comparisonRank, "据え置き")}
                      >
                        据え置き
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {digest && !digestLoading && !digestError && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 border-t mt-3 pt-3">
              <div>
                <h4 className="text-sm font-semibold mb-1.5">昨日からの変化</h4>
                {digest.changesSinceYesterday.length === 0 ? (
                  <p className="text-xs text-muted-foreground">昨日から変化した推奨ランクはありません。</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {digest.changesSinceYesterday.slice(0, 8).map((c) => (
                      <li key={c.date} className="flex items-start gap-2 flex-wrap">
                        <span className="font-medium w-16 shrink-0">{formatMD(c.date)}</span>
                        <span className="tabular-nums shrink-0">
                          {rankLabelOf(c.previousRank)} → <span className="font-semibold">{rankLabelOf(c.newRank)}</span>
                        </span>
                        <span className="text-muted-foreground">{c.reasons.join("、")}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="space-y-2">
                <h4 className="text-sm font-semibold mb-1.5">昨日の答え合わせ</h4>
                {digest.yesterdayReview ? (
                  <p className="text-xs">
                    {formatMD(digest.yesterdayReview.date)} 予測 {pct0(digest.yesterdayReview.predictedOccupancy)} / 実績{" "}
                    {pct0(digest.yesterdayReview.actualOccupancy)}
                    <span className={`ml-1 font-semibold ${deltaColorClass(digest.yesterdayReview.errorPt)}`}>
                      （{digest.yesterdayReview.errorPt >= 0 ? "+" : "−"}
                      {Math.abs(digest.yesterdayReview.errorPt).toFixed(1)}pt）
                    </span>
                    {digest.yesterdayReview.actualRevPar != null && ` RevPAR ${yen(digest.yesterdayReview.actualRevPar)}`}
                    <span className="block text-muted-foreground mt-0.5">{digest.yesterdayReview.comment}</span>
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">実績未確定</p>
                )}
                <p className="text-xs">
                  直近30日の採用率：
                  <span className="font-semibold ml-1">
                    {digest.adoption.adoptionRate != null ? `${Math.round(digest.adoption.adoptionRate * 100)}%` : "-"}
                  </span>
                  <span className="text-muted-foreground ml-1">
                    （採用 {digest.adoption.adopted} / 記録 {digest.adoption.decided} 件）
                  </span>
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

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

      {/* 価格設定パラメータとサマリーを1つのCardに統合 */}
      <Card>
        <CardContent className="py-2.5 px-3">
          <h3 className="text-lg font-semibold mb-2.5">着地予測</h3>

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

          {/* サマリーカード（現在値と着地予測（AI予測）の6指標） */}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3 border-t pt-2.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3 border-t pt-2.5">
              <div className="flex flex-col">
                <p className="text-xs text-muted-foreground mb-0.5">現在のADR</p>
                <div className="text-lg font-semibold mb-0.5">{yen(overallSummary.currentAdr)}</div>
              </div>
              <div className="flex flex-col">
                <p className="text-xs text-muted-foreground mb-0.5">現在の稼働率</p>
                <div className="text-lg font-semibold mb-0.5">{pct(overallSummary.currentOccupancy)}</div>
              </div>
              <div className="flex flex-col">
                <p className="text-xs text-muted-foreground mb-0.5">現在のRevPAR</p>
                <div className="text-lg font-semibold mb-0.5">{yen(overallSummary.currentRevPar)}</div>
              </div>
              <div className="flex flex-col">
                <p className="text-xs text-muted-foreground mb-0.5">着地予測ADR（AI予測）</p>
                <div className="text-lg font-semibold mb-0.5 text-primary">{yen(overallSummary.landingAdr)}</div>
              </div>
              <div className="flex flex-col">
                <p className="text-xs text-muted-foreground mb-0.5">着地予測稼働率（AI予測）</p>
                <div className="text-lg font-semibold mb-0.5 text-primary">{pct(overallSummary.landingOccupancy)}</div>
              </div>
              <div className="flex flex-col">
                <p className="text-xs text-muted-foreground mb-0.5">着地予測RevPAR（AI予測）</p>
                <div className="text-lg font-semibold mb-0.5 text-primary">{yen(overallSummary.landingRevPar)}</div>
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
                            const currentRank = day.currentRank ?? mockCurrentRank(day)
                            const rankDiffers = day.currentRank != null && day.currentRank !== day.recommendedRank
                            const adrDiff = day.actualAdr != null && day.predictedAdr != null ? day.actualAdr - day.predictedAdr : null
                            const occDiff =
                              day.actualOccupancy != null && day.predictedOccupancy != null
                                ? day.actualOccupancy - day.predictedOccupancy
                                : null
                            // 特日 > 祝日 > 通常曜日の順で色付け（色のみで表現、特日は別色）
                            const dayColorClass = special
                              ? "text-warning font-semibold"
                              : holiday || dow === 0
                                ? "text-negative font-semibold"
                                : dow === 6
                                  ? "text-primary"
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
                                    <span className="inline-flex items-center gap-1">
                                      <Badge variant="outline" className="text-xs font-bold px-2">
                                        {rankLabelOf(currentRank)}
                                      </Badge>
                                      {rankDiffers && (
                                        <span
                                          className="w-1.5 h-1.5 rounded-full bg-warning"
                                          title="採用中のランクが推奨と異なります"
                                          aria-label="採用中のランクが推奨と異なります"
                                        />
                                      )}
                                    </span>
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

      {/* 価格戦略の重み付けとガードレール（F-DP-02 / 外部要因設計 P0-4） */}
      <Card>
        <CardContent className="py-2.5 px-3">
          <div className="mb-2.5">
            <h3 className="text-lg font-semibold">価格戦略・ガードレール</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              重み付け（合計100%）と、推奨ランクの上下限・1回の最大変動幅・競合ポジションを設定します
              {!canDecide && "（変更にはMANAGER以上の権限が必要です）"}
            </p>
          </div>

          {strategyLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : strategyError ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <AlertCircle className="w-6 h-6 text-destructive" />
              <p className="text-sm text-muted-foreground">{strategyError}</p>
              <Button variant="outline" size="sm" onClick={loadStrategy} className="gap-2">
                <RefreshCw className="w-4 h-4" />
                再試行
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="strategy-weight-occupancy" className="text-xs">稼働率重視 (%)</Label>
                  <Input
                    id="strategy-weight-occupancy"
                    type="number"
                    min={0}
                    max={100}
                    className="h-8 text-xs"
                    value={Number.isNaN(strategyForm.weightOccupancy) ? "" : strategyForm.weightOccupancy}
                    onChange={(e) => setStrategyField("weightOccupancy", e.target.value)}
                    disabled={!canDecide}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="strategy-weight-adr" className="text-xs">ADR重視 (%)</Label>
                  <Input
                    id="strategy-weight-adr"
                    type="number"
                    min={0}
                    max={100}
                    className="h-8 text-xs"
                    value={Number.isNaN(strategyForm.weightAdr) ? "" : strategyForm.weightAdr}
                    onChange={(e) => setStrategyField("weightAdr", e.target.value)}
                    disabled={!canDecide}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="strategy-weight-competitor" className="text-xs">競合追従 (%)</Label>
                  <Input
                    id="strategy-weight-competitor"
                    type="number"
                    min={0}
                    max={100}
                    className="h-8 text-xs"
                    value={Number.isNaN(strategyForm.weightCompetitor) ? "" : strategyForm.weightCompetitor}
                    onChange={(e) => setStrategyField("weightCompetitor", e.target.value)}
                    disabled={!canDecide}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">合計</Label>
                  <div className={`h-8 flex items-center text-sm font-semibold ${strategyWeightTotal === 100 ? "" : "text-negative"}`}>
                    {strategyWeightTotal}%
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 border-t pt-3">
                <div className="space-y-1">
                  <Label htmlFor="strategy-min-rank" className="text-xs">最小ランク</Label>
                  <Input
                    id="strategy-min-rank"
                    type="number"
                    min={1}
                    max={PRICE_RANK_COUNT}
                    className="h-8 text-xs"
                    value={strategyForm.minRank == null || Number.isNaN(strategyForm.minRank) ? "" : strategyForm.minRank}
                    onChange={(e) => setStrategyField("minRank", e.target.value)}
                    disabled={!canDecide}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="strategy-max-rank" className="text-xs">最大ランク</Label>
                  <Input
                    id="strategy-max-rank"
                    type="number"
                    min={1}
                    max={PRICE_RANK_COUNT}
                    className="h-8 text-xs"
                    value={strategyForm.maxRank == null || Number.isNaN(strategyForm.maxRank) ? "" : strategyForm.maxRank}
                    onChange={(e) => setStrategyField("maxRank", e.target.value)}
                    disabled={!canDecide}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="strategy-max-change" className="text-xs">1回の最大変動幅（ランク）</Label>
                  <Input
                    id="strategy-max-change"
                    type="number"
                    min={0}
                    max={PRICE_RANK_COUNT}
                    className="h-8 text-xs"
                    value={
                      strategyForm.maxDailyRankChange == null || Number.isNaN(strategyForm.maxDailyRankChange)
                        ? ""
                        : strategyForm.maxDailyRankChange
                    }
                    onChange={(e) => setStrategyField("maxDailyRankChange", e.target.value)}
                    disabled={!canDecide}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="strategy-competitor-position" className="text-xs">競合ポジション (%)</Label>
                  <Input
                    id="strategy-competitor-position"
                    type="number"
                    step={1}
                    className="h-8 text-xs"
                    value={
                      strategyForm.competitorPositionPct == null || Number.isNaN(strategyForm.competitorPositionPct)
                        ? ""
                        : strategyForm.competitorPositionPct
                    }
                    onChange={(e) => setStrategyField("competitorPositionPct", e.target.value)}
                    disabled={!canDecide}
                  />
                </div>
              </div>

              {/* 自動採用（日次ジョブによる推奨の自動適用 — 外部要因設計 Phase 2） */}
              <div className="border-t pt-3 space-y-2">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="space-y-0.5">
                    <Label htmlFor="strategy-auto-adopt" className="text-sm font-medium">自動採用</Label>
                    <p className="text-xs text-muted-foreground">
                      有効にすると日次ジョブが条件を満たす日の推奨を自動で適用済みとして記録します
                    </p>
                  </div>
                  <Switch
                    id="strategy-auto-adopt"
                    checked={strategyForm.autoAdopt ?? false}
                    onCheckedChange={(checked) => setStrategyForm((prev) => ({ ...prev, autoAdopt: checked }))}
                    disabled={!canDecide}
                  />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="strategy-auto-adopt-confidence" className="text-xs">最低信頼度（0〜1）</Label>
                    <Input
                      id="strategy-auto-adopt-confidence"
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      className="h-8 text-xs"
                      value={
                        strategyForm.autoAdoptMinConfidence == null || Number.isNaN(strategyForm.autoAdoptMinConfidence)
                          ? ""
                          : strategyForm.autoAdoptMinConfidence
                      }
                      onChange={(e) => setStrategyField("autoAdoptMinConfidence", e.target.value)}
                      disabled={!canDecide || !strategyForm.autoAdopt}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="strategy-auto-adopt-lead" className="text-xs">対象リードタイム（日）</Label>
                    <Input
                      id="strategy-auto-adopt-lead"
                      type="number"
                      min={0}
                      max={365}
                      step={1}
                      className="h-8 text-xs"
                      value={
                        strategyForm.autoAdoptMaxLeadDays == null || Number.isNaN(strategyForm.autoAdoptMaxLeadDays)
                          ? ""
                          : strategyForm.autoAdoptMaxLeadDays
                      }
                      onChange={(e) => setStrategyField("autoAdoptMaxLeadDays", e.target.value)}
                      disabled={!canDecide || !strategyForm.autoAdopt}
                    />
                  </div>
                  <p className="col-span-2 text-[11px] text-muted-foreground self-end pb-1.5">
                    予測の信頼度が最低信頼度以上、かつ宿泊日までの日数が対象リードタイム以内の日だけが自動採用の対象です
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className={`text-xs ${strategyValidationError ? "text-negative" : "text-muted-foreground"}`}>
                  {strategyValidationError ??
                    "競合ポジションは競合中央値に対する自社価格の位置（例: +5 = 5%高め、−5 = 5%安め）です"}
                </p>
                {canDecide && (
                  <Button
                    size="sm"
                    className="h-8 text-xs gap-2"
                    disabled={savingStrategy || strategyValidationError != null || !strategy}
                    onClick={handleSaveStrategy}
                  >
                    {savingStrategy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    保存
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 当月のイベント情報（実API接続 — F-DP-07） */}
      <Card>
        <CardContent className="py-2.5 px-3">
          <div className="flex items-center justify-between mb-2.5 flex-wrap gap-2">
            <div>
              <h3 className="text-lg font-semibold">当月のイベント情報</h3>
              <p className="text-xs text-muted-foreground mt-0.5">近隣イベントは需要予測の参考情報として登録されます</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {canDecide && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-2"
                  onClick={handleDetectCandidates}
                  disabled={detectingCandidates}
                >
                  {detectingCandidates ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  前年の実績から候補を検出
                </Button>
              )}
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
                        <Select value={newEventImpact} onValueChange={(v: "high" | "medium" | "low" | "negative" | "auto") => setNewEventImpact(v)}>
                          <SelectTrigger id="new-event-impact" className="h-9 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {newEventVenueId !== "none" && <SelectItem value="auto">自動（会場から推定）</SelectItem>}
                            <SelectItem value="high">高</SelectItem>
                            <SelectItem value="medium">中</SelectItem>
                            <SelectItem value="low">低</SelectItem>
                            <SelectItem value="negative">需要減（工事・障害など）</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="new-event-venue">会場（任意）</Label>
                        <Select value={newEventVenueId} onValueChange={handleSelectVenue}>
                          <SelectTrigger id="new-event-venue" className="h-9 text-sm">
                            <SelectValue placeholder="会場を選択" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">指定なし</SelectItem>
                            {venues.map((v) => (
                              <SelectItem key={v.id} value={v.id}>
                                {v.name}
                                {v.capacity != null ? `（${v.capacity.toLocaleString()}人）` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {venues.length === 0 && (
                          <p className="text-[11px] text-muted-foreground">会場は設定画面の「会場マスタ」で登録できます</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="new-event-attendance">見込み来場者数（任意）</Label>
                        <input
                          id="new-event-attendance"
                          type="number"
                          min={0}
                          step={1}
                          value={newEventAttendance}
                          onChange={(e) => setNewEventAttendance(e.target.value)}
                          placeholder="例：30000"
                          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                        />
                      </div>
                    </div>
                    {newEventVenueId !== "none" && (
                      <p className="text-xs text-muted-foreground -mt-2">
                        影響度は会場の収容人数と距離から自動推定されます（手動で上書き可）
                      </p>
                    )}
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
                    <Button size="sm" className="gap-2" disabled={savingEvent} onClick={handleCreateEvent}>
                      {savingEvent ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      登録
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
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
                      {ev.venue?.name ? ` ・ ${ev.venue.name}` : ev.location ? ` ・ ${ev.location}` : ""}
                      {ev.expectedAttendance != null ? ` ・ 見込み ${ev.expectedAttendance.toLocaleString()}人` : ""}
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

          {/* イベント候補（前年実績からの自動検出・会場ページからの抽出 — 承認するとイベントとして需要予測に反映） */}
          <div className="border-t mt-3 pt-3">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <div>
                <h4 className="text-sm font-semibold">
                  イベント候補（承認待ち）
                  {!candidatesLoading && !candidatesError && candidates.length > 0 && (
                    <Badge variant="secondary" className="ml-2 text-[10px]">{candidates.length}件</Badge>
                  )}
                </h4>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  前年実績の突出日や会場の公式ページから見つかった候補です。承認するとイベントとして登録され、需要予測に反映されます
                  {!canDecide && "（承認・却下にはMANAGER以上の権限が必要です）"}
                </p>
              </div>
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5" onClick={loadCandidates} disabled={candidatesLoading}>
                <RefreshCw className={`w-3.5 h-3.5 ${candidatesLoading ? "animate-spin" : ""}`} />
                更新
              </Button>
            </div>

            {candidatesLoading ? (
              <Skeleton className="h-12 w-full" />
            ) : candidatesError ? (
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <AlertCircle className="w-5 h-5 text-destructive" />
                <p className="text-xs text-muted-foreground">{candidatesError}</p>
                <Button variant="outline" size="sm" onClick={loadCandidates} className="gap-2 h-7 text-xs">
                  <RefreshCw className="w-3.5 h-3.5" />
                  再試行
                </Button>
              </div>
            ) : candidates.length === 0 ? (
              <p className="text-xs text-muted-foreground py-3 text-center">承認待ちの候補はありません。</p>
            ) : (
              <div className="space-y-2">
                {candidates.map((c) => {
                  const busy = reviewingCandidateId === c.id
                  return (
                    <div key={c.id} className="flex items-start justify-between gap-3 border border-dashed rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{c.name}</span>
                          <Badge variant="secondary" className="text-[10px]">{candidateSourceLabel(c.source)}</Badge>
                          <Badge variant="outline" className="text-[10px]">{eventTypeLabel(c.type)}</Badge>
                          <Badge className={`${impactBadgeClass(c.expectedImpact)} text-[10px]`}>{impactLabel(c.expectedImpact)}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          候補日 {formatEventRange(c.startDate, c.endDate)}
                          {c.venue?.name ? ` ・ ${c.venue.name}` : c.location ? ` ・ ${c.location}` : ""}
                          {c.expectedAttendance != null ? ` ・ 見込み ${c.expectedAttendance.toLocaleString()}人` : ""}
                        </p>
                        {c.description && <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{c.description}</p>}
                      </div>
                      {canDecide && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button
                            size="sm"
                            className="h-7 text-xs gap-1"
                            disabled={reviewingCandidateId != null}
                            onClick={() => openApproveDialog(c)}
                          >
                            {busy && approvingCandidate?.id === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            承認
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1"
                            disabled={reviewingCandidateId != null}
                            onClick={() => handleRejectCandidate(c)}
                          >
                            {busy && approvingCandidate == null ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                            却下
                          </Button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* 候補の承認ダイアログ（名称・期間・影響度を確認・修正してから登録） */}
          <Dialog open={approvingCandidate != null} onOpenChange={(open) => !open && !reviewingCandidateId && setApprovingCandidate(null)}>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle className="text-lg font-semibold">イベント候補を承認</DialogTitle>
                <DialogDescription className="text-sm">
                  内容を確認・修正してイベントとして登録します。
                  {approvingCandidate?.sourceRef && (
                    <span className="block text-xs mt-1 break-all">検出元: {approvingCandidate.sourceRef}</span>
                  )}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="approve-event-name">イベント名</Label>
                  <input
                    id="approve-event-name"
                    value={approveName}
                    onChange={(e) => setApproveName(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="approve-event-type">種別</Label>
                    <Select value={approveType} onValueChange={setApproveType}>
                      <SelectTrigger id="approve-event-type" className="h-9 text-sm">
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
                    <Label htmlFor="approve-event-impact">影響度</Label>
                    <Select value={approveImpact} onValueChange={(v: EventImpact) => setApproveImpact(v)}>
                      <SelectTrigger id="approve-event-impact" className="h-9 text-sm">
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
                    <Label htmlFor="approve-event-start">開始日</Label>
                    <input
                      id="approve-event-start"
                      type="date"
                      value={approveStart}
                      onChange={(e) => setApproveStart(e.target.value)}
                      className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="approve-event-end">終了日</Label>
                    <input
                      id="approve-event-end"
                      type="date"
                      value={approveEnd}
                      onChange={(e) => setApproveEnd(e.target.value)}
                      className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    />
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" size="sm" onClick={() => setApprovingCandidate(null)} disabled={reviewingCandidateId != null}>
                  キャンセル
                </Button>
                <Button size="sm" className="gap-2" disabled={reviewingCandidateId != null} onClick={handleApproveCandidate}>
                  {reviewingCandidateId != null ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  承認して登録
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      {/* 外部要因（祝日・連休・天候 — 外部要因設計 P0-2 / P1-7） */}
      <Card>
        <CardContent className="py-2.5 px-3">
          <div className="flex items-center justify-between mb-2.5 flex-wrap gap-2">
            <div>
              <h3 className="text-lg font-semibold">外部要因（{monthLabelOf(Number(targetMonth.slice(0, 4)), Number(targetMonth.slice(5, 7)))}）</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                祝日・連休・特別期間と雨天予報は需要予測の要因として自動で反映されます。天候予報は設定画面の気象庁コード・緯度経度をもとに取得します
              </p>
            </div>
            {canDecide && (
              <Button variant="outline" size="sm" className="h-8 text-xs gap-2" onClick={handleIngestSignals} disabled={ingestingSignals}>
                {ingestingSignals ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudRain className="w-3.5 h-3.5" />}
                天候予報を取り込む
              </Button>
            )}
          </div>

          {signalsLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : signalsError ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <AlertCircle className="w-6 h-6 text-destructive" />
              <p className="text-sm text-muted-foreground">{signalsError}</p>
              <Button variant="outline" size="sm" onClick={loadSignals} className="gap-2">
                <RefreshCw className="w-4 h-4" />
                再試行
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="text-sm font-semibold mb-1.5">祝日・連休・特別期間</h4>
                {holidaySignals.length === 0 ? (
                  <p className="text-xs text-muted-foreground">この月に連休・特別期間はありません。</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {holidaySignals.map((s) => (
                      <li key={s.date} className="flex items-start gap-2">
                        <span className={`font-medium w-16 shrink-0 ${s.holiday.isHoliday ? "text-negative" : ""}`}>{formatMD(s.date)}</span>
                        <span>{describeHolidaySignal(s.holiday)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h4 className="text-sm font-semibold mb-1.5">雨天予報</h4>
                {rainySignals.length === 0 ? (
                  <p className="text-xs text-muted-foreground">雨天予報の日はありません（予報は取り込み済みの期間のみ表示されます）。</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {rainySignals.map((s) => (
                      <li key={s.date} className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium w-16 shrink-0">{formatMD(s.date)}</span>
                        <span>降水確率 {s.weather?.rainProbability != null ? `${s.weather.rainProbability}%` : "-"}</span>
                        {s.weather?.tempMax != null && s.weather?.tempMin != null && (
                          <span className="text-muted-foreground">
                            {s.weather.tempMin}〜{s.weather.tempMax}℃
                          </span>
                        )}
                        {s.weather && (
                          <Badge variant="outline" className="text-[10px]">
                            {s.weather.source === "jma" ? "気象庁" : s.weather.source === "open_meteo" ? "Open-Meteo" : s.weather.source}
                          </Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
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
                    <DialogDescription>AIによる推奨価格・需要アラートの詳細です</DialogDescription>
                  </DialogHeader>

                  <div className="space-y-6 mt-4">
                    <div className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">推奨価格（料金ランク {day.rankLabel ?? "-"}）</div>
                        {day.explanation ? (
                          <Badge variant="outline" className="text-xs">
                            稼働率 {Math.round(day.explanation.confidence.p10 * 100)}〜{Math.round(day.explanation.confidence.p90 * 100)}%（中央{" "}
                            {Math.round(day.explanation.confidence.p50 * 100)}%）
                          </Badge>
                        ) : (
                          day.confidence != null && <Badge variant="outline" className="text-xs">信頼度 {(day.confidence * 100).toFixed(0)}%</Badge>
                        )}
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

                    <RecommendationReason
                      day={day}
                      canDecide={canDecide}
                      deciding={decidingDate === day.date}
                      onAdopt={(d) => d.recommendedRank != null && handleDecide(d.date, d.recommendedRank)}
                    />

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

                    <RecommendationReason
                      day={day}
                      canDecide={canDecide}
                      deciding={decidingDate === day.date}
                      onAdopt={(d) => d.recommendedRank != null && handleDecide(d.date, d.recommendedRank)}
                    />
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
                    ${cell.dayOfWeek === 0 ? "bg-negative/5" : cell.dayOfWeek === 6 ? "bg-primary/5" : ""}
                    border-r border-b
                    ${cell.isCurrentMonth && cell.data ? "cursor-pointer hover:bg-muted/50 transition-colors" : ""}
                  `}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div
                      className={`font-medium inline-flex items-center justify-center ${
                        cell.dayOfWeek === 0 ? "text-negative" : cell.dayOfWeek === 6 ? "text-primary" : ""
                      }`}
                    >
                      {cell.date}
                    </div>
                    {cell.isCurrentMonth && cell.data?.rankLabel && (
                      <span className="inline-flex items-center gap-0.5">
                        {cell.data.currentRank != null && cell.data.currentRank !== cell.data.recommendedRank && (
                          <span
                            className="w-1.5 h-1.5 rounded-full bg-warning"
                            title={`採用中 ${rankLabelOf(cell.data.currentRank)}（推奨と異なります）`}
                            aria-label={`採用中 ${rankLabelOf(cell.data.currentRank)}（推奨と異なります）`}
                          />
                        )}
                        <Badge className={`${getRankBadgeColor(cell.data.recommendedRank ?? 0)} text-[9px] font-bold px-1 py-0 h-4`}>
                          {cell.data.rankLabel}
                        </Badge>
                      </span>
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
