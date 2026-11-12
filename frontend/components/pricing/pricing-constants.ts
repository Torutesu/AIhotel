// ダイナミックプライシング画面の共通定数・表示ヘルパー（U-15 で pricing-tab.tsx から分割）

import { EVENT_TYPE_OPTIONS } from "@/components/pricing/event-dialog"
import type { PricingCalendarDay } from "@/lib/api"
import type { Event as HotelEvent } from "@shared/types"
import { JP_HOLIDAYS } from "@/lib/jp-holidays-data"

export function eventTypeLabel(type: string): string {
  return EVENT_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type
}

export function impactBadgeClass(impact?: string | null): string {
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

export function impactLabel(impact?: string | null): string {
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

export function formatEventDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })
}

export function formatEventRange(start: Date | string, end: Date | string): string {
  const s = formatEventDate(start)
  const e = formatEventDate(end)
  return s === e ? s : `${s} 〜 ${e}`
}

/** "yyyy-MM-dd" に変換する（API は日付を ISO 文字列で返す） */
function eventDateKey(value: Date | string): string {
  return (typeof value === "string" ? value : value.toISOString()).slice(0, 10)
}

/** 指定日（"yyyy-MM-dd"）にかかっている登録済みイベント（#80） */
export function eventsOnDate(events: HotelEvent[], date: string): HotelEvent[] {
  return events.filter((ev) => eventDateKey(ev.startDate) <= date && date <= eventDateKey(ev.endDate))
}

// 料金ランクのバッジカラー（バックエンドは40段階でランクを管理 — backend/prisma/seed.ts の PRICE_RANK_COUNT）
export const PRICE_RANK_COUNT = 40
export function getRankBadgeColor(rank: number): string {
  const band = Math.ceil((rank / PRICE_RANK_COUNT) * 5)
  if (band <= 1) return "bg-primary text-white"
  if (band <= 2) return "bg-[color:var(--chart-2)] text-white"
  if (band <= 3) return "bg-[color:var(--chart-4)] text-white"
  if (band <= 4) return "bg-warning text-white"
  return "bg-negative text-white"
}

export function demandBadgeClass(demand: string | null): string {
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

export function demandDescription(demand: string | null): string {
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

// 祝日（内閣府「国民の祝日」— D-13。scripts/update-jp-holidays.mjs が作る一覧。バックエンドの lib/jpHolidays.ts と同じ）
const pad2 = (n: number) => String(n).padStart(2, "0")
const localIso = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`

export function holidayNameOf(date: Date): string | null {
  return JP_HOLIDAYS[localIso(date)] ?? null
}

// 特日（お盆・年末年始・GW・祝前日。バックエンドの services/forecast/specialDays.ts・lib/travelSeasons.ts と同じ判定。
// 範囲は先方の資料「外部要因と旅行（宿泊）の関連付け」の時間軸: 年末年始 12/27〜1/5、GW 4/28〜5/6、お盆は山の日〜8/16）
export function specialDayNameOf(date: Date): string | null {
  const m = date.getMonth() + 1
  const d = date.getDate()
  const mountainDay =
    Array.from({ length: 31 }, (_, i) => i + 1).find((day) => JP_HOLIDAYS[`${date.getFullYear()}-08-${pad2(day)}`] === "山の日") ?? 11
  if (m === 8 && d >= mountainDay && d <= 16) return "お盆"
  if ((m === 12 && d >= 27) || (m === 1 && d <= 5)) return "年末年始"
  if ((m === 4 && d >= 28) || (m === 5 && d <= 6)) return "GW"
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
  if (holidayNameOf(next) != null) return "祝前日"
  return null
}

// AI価格最適化の提案（モック。レベルを色付きバッジで表示）
export const AI_PRICING_PROPOSALS: Array<{ level: "high" | "medium" | "low"; text: string }> = [
  {
    level: "high",
    text: "週末の需要が高まる見込みです。週末（既定は金・土曜日）にかけて段階的な価格引き上げを推奨します（平均+12%の増収見込み）。",
  },
  {
    level: "medium",
    text: "平日の稼働率向上のため、週末以外の日の価格を5%引き下げることで、稼働率を15%向上できる見込みです。",
  },
  {
    level: "low",
    text: "競合ホテルの価格動向を監視中です。現在の価格設定は市場平均より2.5%高く、品質優位性を考慮すると適正範囲内です。",
  },
]

export const PROPOSAL_LEVEL_STYLE: Record<string, { label: string; className: string }> = {
  high: { label: "レベル高", className: "bg-negative text-white" },
  medium: { label: "レベル中", className: "bg-warning text-white" },
  low: { label: "レベル低", className: "bg-primary text-white" },
}

/** 表示中の1か月分のカレンダー */
export interface MonthCalendar {
  year: number
  month: number
  /** 客室数（API が返せば） */
  totalRooms?: number
  calendar: PricingCalendarDay[]
}

/** 料金ランクのラベル（R01 形式） */
export function rankLabelOf(rank: number): string {
  return `R${String(rank).padStart(2, "0")}`
}

/**
 * 表示月の販売開始の状況（2026-10 PDF b04「販売開始日はホテル単位で何日前と固定」）。
 * 宿泊日の daysBefore 日前に販売を始めるので、月の1日と末日の販売開始日から「販売開始前／一部販売中／全日販売中」を決める
 */
export function saleOpenStatus(
  year: number,
  month: number,
  daysBefore: number | null | undefined,
  today = new Date(),
): { state: "before" | "partial" | "open"; firstOpen: Date; lastOpen: Date; openedThrough: Date | null } | null {
  if (daysBefore == null || daysBefore <= 0) return null
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const first = new Date(year, month - 1, 1)
  const last = new Date(year, month, 0)
  const firstOpen = new Date(year, month - 1, 1 - daysBefore)
  const lastOpen = new Date(year, month - 1, last.getDate() - daysBefore)
  if (start >= lastOpen) return { state: "open", firstOpen, lastOpen, openedThrough: last }
  if (start < firstOpen) return { state: "before", firstOpen, lastOpen, openedThrough: null }
  // 今日販売を始めた宿泊日 = 今日 + daysBefore
  const through = new Date(start.getFullYear(), start.getMonth(), start.getDate() + daysBefore)
  return { state: "partial", firstOpen, lastOpen, openedThrough: through < first ? null : through }
}

/** 日の予算の出どころ（D-13 — PricingCalendarDay.budgetSource） */
export const BUDGET_SOURCE_LABELS: Record<NonNullable<PricingCalendarDay["budgetSource"]>, string> = {
  imported: "日別予算",
  ai: "AIの予測で配分",
  lastYear: "前年同曜日で配分",
}
