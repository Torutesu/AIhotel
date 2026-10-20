"use client"

// 日のタイプ（日のモデル — 2026-10 の画面修正。PDF b01・b02・b03・c分析01実績推移2、xlsx DP02・DP03・分析03）の表示部品。
// 判定はバックエンド（backend/src/services/forecast/dayType.ts）が行い、画面は受け取った値を表示する。
//   平日・週末・特日ごとに、過去の結果（最終の稼働率）から AI が型を作る（例: 平日A型・平日B型・週末A型）。型の数はデータで決まり、
//   区分の中で稼働の高い型から A・B・C・D。型ごとに優先モデル（稼働優先・バランス・単価優先）を持つ。
//   先の日は、今の予約の入り方が型の典型的な予約の入り方のどれに近いかで決まるので、予約が進むと型が変わる（推移）。

import { Info } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { formatPercent } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { DayModel } from "@/lib/api"

export const DAY_MODEL_LABELS: Record<DayModel, string> = { occupancy: "稼働優先", balanced: "バランス", adr: "単価優先" }

export const DAY_MODEL_DESCRIPTIONS: Record<DayModel, string> = {
  occupancy: "客室を埋めることを優先し、価格は上げすぎない",
  balanced: "稼働と単価を初期値の重みどおりに見る",
  adr: "埋まりやすい日なので、単価を上げることを優先する",
}

/** 型名の英字（"平日A型" → "A"） */
export function dayTypeLetter(dayType: string | null | undefined): string | null {
  return dayType?.match(/([A-Z])型$/)?.[1] ?? null
}

/** 型名の区分（"平日A型" → "平日"） */
export function dayTypeCategory(dayType: string | null | undefined): string | null {
  return dayType?.match(/^(平日|週末|特日)/)?.[1] ?? null
}

/** 日のタイプのバッジの色。アラート（塗りつぶし）と見分けられるよう、枠線と文字色だけで表す */
export function dayTypeBadgeClass(dayType: string | null | undefined): string {
  switch (dayTypeLetter(dayType)) {
    case "A":
      return "border-primary text-primary"
    case "B":
      return "border-[color:var(--cyan-edge)] text-[color:var(--cyan-edge)]"
    case "C":
      return "border-foreground/40 text-foreground"
    case "D":
      return "border-warning text-warning"
    default:
      return "text-muted-foreground"
  }
}

const LETTER_RANKS: Record<string, string> = { A: "いちばん強い", B: "2番目に強い", C: "3番目に強い", D: "4番目に強い" }

/** 日のタイプを文章にする（例「平日の中で需要がいちばん強い型（平均稼働 92%）・単価優先」） */
export function describeDayType(dayType: string | null | undefined, model?: DayModel | null, typicalOccupancy?: number | null): string {
  if (!dayType) return "過去の実績が足りないため、型を作れていません"
  const letter = dayTypeLetter(dayType)
  const category = dayTypeCategory(dayType)
  const parts = [
    `${category ?? ""}の中で需要が${(letter && LETTER_RANKS[letter]) ?? ""}型${typicalOccupancy != null ? `（平均稼働 ${formatPercent(typicalOccupancy)}）` : ""}`,
    model ? DAY_MODEL_LABELS[model] : null,
  ]
  return parts.filter(Boolean).join("・")
}

/** 残日数の表示名（0 = 当日） */
export function leadLabel(daysBefore: number): string {
  return daysBefore === 0 ? "当日" : `${daysBefore}日前`
}

export const DAY_TYPE_HELP =
  "平日・週末・特日ごとに、過去の結果（最終の稼働率）から AI が日を型に分けます（例: 平日A型・平日B型・週末A型）。型の数はデータで決まり、区分の中で稼働の高い型から A・B・C です。" +
  "型ごとに、稼働と単価のどちらを優先して価格を決めるか（優先モデル）が決まっています。先の日は今の予約の入り方に近い型になるため、予約が進むと型と優先モデルが変わります。"

interface DayTypeBadgeProps {
  dayType: string | null | undefined
  model?: DayModel | null
  typicalOccupancy?: number | null
  size?: "sm" | "lg"
  className?: string
}

export function DayTypeBadge({ dayType, model, typicalOccupancy, size = "sm", className }: DayTypeBadgeProps) {
  if (!dayType) return <span className="text-xs text-muted-foreground">-</span>
  const detail = describeDayType(dayType, model, typicalOccupancy)
  return (
    <Badge
      variant="outline"
      title={detail}
      aria-label={`日のタイプ ${dayType}（${detail}）`}
      className={cn(
        "whitespace-nowrap bg-background font-bold",
        dayTypeBadgeClass(dayType),
        size === "lg" ? "px-3 py-1 text-lg" : "px-1.5 text-xs",
        className,
      )}
    >
      {dayType}
    </Badge>
  )
}

/** 優先モデルのバッジ（稼働優先・バランス・単価優先） */
export function DayModelBadge({ model, className }: { model: DayModel | null | undefined; className?: string }) {
  if (!model) return null
  return (
    <Badge variant="secondary" title={DAY_MODEL_DESCRIPTIONS[model]} className={cn("whitespace-nowrap text-[11px]", className)}>
      {DAY_MODEL_LABELS[model]}
    </Badge>
  )
}

/** 見出しの横に置く説明（ツールチップ） */
export function DayTypeHelp({ label = "日のタイプ" }: { label?: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-help items-center justify-center gap-1">
            {label}
            <Info className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-sm">
          <p className="text-xs leading-relaxed">{DAY_TYPE_HELP}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
