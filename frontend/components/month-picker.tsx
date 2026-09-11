"use client"

// 対象年月の共通ピッカー（U-9）
// 生の <input type="month"> はブラウザ既定のUI・英語表記になるため使わず、
// 年と月の shadcn Select を組み合わせて日本語表記に揃える。値は "YYYY-MM"。

import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { parseMonthStr } from "@/lib/date"

interface MonthPickerProps {
  /** "YYYY-MM" */
  value: string
  onChange: (value: string) => void
  /** 年セレクトの id（ラベルの htmlFor 用） */
  id?: string
  /** 選択できる年の範囲（現在年からの相対）。既定は前2年〜翌2年 */
  yearOffsets?: number[]
  disabled?: boolean
  className?: string
  /** 読み上げ用のラベル（表示はしない） */
  ariaLabel?: string
}

const DEFAULT_YEAR_OFFSETS = [-2, -1, 0, 1, 2]

export function MonthPicker({
  value,
  onChange,
  id,
  yearOffsets = DEFAULT_YEAR_OFFSETS,
  disabled = false,
  className,
  ariaLabel,
}: MonthPickerProps) {
  const { year, month } = parseMonthStr(value)
  const currentYear = new Date().getFullYear()
  const years = [...new Set([...yearOffsets.map((o) => currentYear + o), year])].sort((a, b) => a - b)

  const emit = (nextYear: number, nextMonth: number) => {
    onChange(`${nextYear}-${String(nextMonth).padStart(2, "0")}`)
  }

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Select
        value={String(year)}
        disabled={disabled}
        onValueChange={(v) => emit(Number(v), month)}
      >
        <SelectTrigger id={id} className="h-8 w-24 text-xs" aria-label={ariaLabel ?? "対象年"}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {years.map((y) => (
            <SelectItem key={y} value={String(y)}>
              {y}年
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={String(month)}
        disabled={disabled}
        onValueChange={(v) => emit(year, Number(v))}
      >
        <SelectTrigger className="h-8 w-20 text-xs" aria-label="対象月">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <SelectItem key={m} value={String(m)}>
              {m}月
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/** ラベル付きの MonthPicker（「対象月 [2026年][9月]」のひとまとまり） */
export function LabeledMonthPicker({
  label,
  id,
  ...props
}: MonthPickerProps & { label: string; id: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={id} className="whitespace-nowrap text-xs">
        {label}
      </Label>
      <MonthPicker id={id} {...props} ariaLabel={label} />
    </div>
  )
}
