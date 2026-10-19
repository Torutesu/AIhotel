"use client"

// 日のタイプ（2026-10 のデモ画面の修正 DP02 / DP03 / 分析03）の表示部品。
// 判定はバックエンド（backend/src/services/forecast/dayType.ts）が行い、画面は受け取った値を表示する。
//   英字 = 着地見込みの需要（A〜E。需要レベルと同じ境目）
//   数字 = 前年同曜日と比べた予約の入り方（1 = 20%以上先行 … 3 = 前年並み … 5 = 20%以上遅れ）

import { Info } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { formatPercent } from "@/lib/format"
import { cn } from "@/lib/utils"

export const DAY_TYPE_GRADE_LABELS: Record<string, string> = {
  A: "着地見込み 90%超",
  B: "着地見込み 80〜90%",
  C: "着地見込み 65〜80%",
  D: "着地見込み 50〜65%",
  E: "着地見込み 50%以下",
}

export const DAY_TYPE_PACE_LABELS: Record<string, string> = {
  "1": "前年より20%以上先行",
  "2": "前年より5〜20%先行",
  "3": "前年並み（±5%未満）",
  "4": "前年より5〜20%遅れ",
  "5": "前年より20%以上遅れ",
}

/** 日のタイプのバッジの色。アラート（塗りつぶし）と見分けられるよう、枠線と文字色だけで表す */
export function dayTypeBadgeClass(dayType: string | null | undefined): string {
  switch (dayType?.[0]) {
    case "A":
      return "border-primary text-primary"
    case "B":
      return "border-[color:var(--cyan-edge)] text-[color:var(--cyan-edge)]"
    case "C":
      return "border-foreground/40 text-foreground"
    case "D":
      return "border-warning text-warning"
    case "E":
      return "border-negative text-negative"
    default:
      return "text-muted-foreground"
  }
}

/** 日のタイプを文章にする（例「着地見込み 80〜90%・前年より20%以上先行」） */
export function describeDayType(dayType: string | null | undefined): string {
  if (!dayType) return "判定に使う予約・予測のデータがありません"
  const grade = DAY_TYPE_GRADE_LABELS[dayType[0]] ?? dayType[0]
  const pace = dayType[1] ? DAY_TYPE_PACE_LABELS[dayType[1]] : "前年と比べられないため数字なし"
  return `${grade}・${pace}`
}

/** 残日数の表示名（0 = 当日） */
export function leadLabel(daysBefore: number): string {
  return daysBefore === 0 ? "当日" : `${daysBefore}日前`
}

export const DAY_TYPE_HELP =
  "英字は着地見込みの需要（A〜E）、数字は前年同曜日と比べた予約の入り方（1＝20%以上先行・3＝前年並み・5＝20%以上遅れ）です。" +
  "着地見込みは「今の予約室数＋前年同曜日がその時点から伸びた室数」で出します。前年と比べられない日は AI の予測稼働率で英字だけを出します。"

interface DayTypeBadgeProps {
  dayType: string | null | undefined
  expectedOccupancy?: number | null
  paceRatio?: number | null
  size?: "sm" | "lg"
  className?: string
}

export function DayTypeBadge({ dayType, expectedOccupancy, paceRatio, size = "sm", className }: DayTypeBadgeProps) {
  if (!dayType) return <span className="text-xs text-muted-foreground">-</span>
  const detail = [
    describeDayType(dayType),
    expectedOccupancy != null ? `着地見込み ${formatPercent(expectedOccupancy)}` : null,
    paceRatio != null ? `前年同曜日の ${paceRatio.toFixed(2)}倍のペース` : null,
  ]
    .filter(Boolean)
    .join("／")
  return (
    <Badge
      variant="outline"
      title={detail}
      aria-label={`日のタイプ ${dayType}（${detail}）`}
      className={cn(
        "bg-background font-mono font-bold tabular-nums",
        dayTypeBadgeClass(dayType),
        size === "lg" ? "px-3 py-1 text-lg" : "px-1.5 text-xs",
        className,
      )}
    >
      {dayType}
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
