// ダイナミックプライシング画面の共通定数・表示ヘルパー（U-15 で pricing-tab.tsx から分割）

import { EVENT_TYPE_OPTIONS } from "@/components/pricing/event-dialog"
import type { PricingCalendarDay } from "@/lib/api"

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

// 固定日の祝日（モックアップ用の簡易判定。移動祝日は含まない）
export const FIXED_HOLIDAYS: Record<string, string> = {
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

export function holidayNameOf(date: Date): string | null {
  return FIXED_HOLIDAYS[`${date.getMonth() + 1}-${date.getDate()}`] ?? null
}

// 特日（お盆・年末年始・GW等の高需要期。AIが候補を提示し、オペレーターがマスタ設定画面で修正する想定）
export function specialDayNameOf(date: Date): string | null {
  const m = date.getMonth() + 1
  const d = date.getDate()
  if (m === 8 && d >= 13 && d <= 16) return "お盆"
  if ((m === 12 && d >= 29) || (m === 1 && d <= 3)) return "年末年始"
  if ((m === 4 && d >= 29) || (m === 5 && d <= 5)) return "GW"
  return null
}

// 部屋タイプ・部屋タイプグループの選択肢（マスタ設定に相当するモック定義。先頭がデフォルト表示）
export const ROOM_TYPES = [
  { value: "standard", label: "スタンダード", priceFactor: 1.0 },
  { value: "deluxe", label: "デラックス", priceFactor: 1.35 },
  { value: "suite", label: "スイート", priceFactor: 1.9 },
]

export const ROOM_TYPE_GROUPS = [
  { value: "group-standard", label: "スタンダード系グループ" },
  { value: "group-premium", label: "プレミアム系グループ" },
]

// AI価格最適化の提案（モック。レベルを色付きバッジで表示）
export const AI_PRICING_PROPOSALS: Array<{ level: "high" | "medium" | "low"; text: string }> = [
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

export const PROPOSAL_LEVEL_STYLE: Record<string, { label: string; className: string }> = {
  high: { label: "レベル高", className: "bg-negative text-white" },
  medium: { label: "レベル中", className: "bg-warning text-white" },
  low: { label: "レベル低", className: "bg-primary text-white" },
}

/** 表示中の1か月分のカレンダー */
export interface MonthCalendar {
  year: number
  month: number
  calendar: PricingCalendarDay[]
}

/** 料金ランクのラベル（R01 形式） */
export function rankLabelOf(rank: number): string {
  return `R${String(rank).padStart(2, "0")}`
}
