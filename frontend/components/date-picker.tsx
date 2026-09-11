"use client"

// 日付選択の共通ピッカー（U-9）
// react-day-picker を ja ロケール固定で使い、英語の月名が出ないようにする。
// 生の <input type="date"> の代わりに使う。

import { CalendarIcon } from "lucide-react"
import { format } from "date-fns"
import { ja } from "date-fns/locale/ja"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface DatePickerProps {
  value: Date | undefined
  onChange: (date: Date | undefined) => void
  id?: string
  /** 未選択時に表示する文言 */
  placeholder?: string
  /** 表示フォーマット（date-fns）。既定は "yyyy年M月d日" */
  displayFormat?: string
  /** 選択不可の日 */
  disabledDates?: (date: Date) => boolean
  disabled?: boolean
  className?: string
  /** 読み上げ用のラベル */
  ariaLabel?: string
  align?: "start" | "center" | "end"
}

export function DatePicker({
  value,
  onChange,
  id,
  placeholder = "日付を選択",
  displayFormat = "yyyy年M月d日",
  disabledDates,
  disabled = false,
  className,
  ariaLabel,
  align = "start",
}: DatePickerProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label={ariaLabel ?? placeholder}
          className={cn("h-8 justify-start gap-2 text-xs font-normal", className)}
        >
          <CalendarIcon className="h-3.5 w-3.5" aria-hidden />
          {value ? format(value, displayFormat, { locale: ja }) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align}>
        <Calendar
          mode="single"
          locale={ja}
          selected={value}
          onSelect={onChange}
          disabled={disabledDates}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}
