"use client"

// イベント登録・編集ダイアログ（U-3 / U-11 / U-15）
// 新規登録（POST /events）と編集（PUT /events/:id）を同じフォームで扱う。
// 入力検証は zod + react-hook-form でインライン表示する（トーストだけに頼らない）。

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { Loader2, Save } from "lucide-react"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DatePicker } from "@/components/date-picker"
import { FormFieldError } from "@/components/form-field-error"
import { toDateStr } from "@/lib/date"
import { zodResolver } from "@/lib/zod-resolver"
import type { Event as HotelEvent } from "@shared/types"

export const EVENT_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "concert", label: "コンサート" },
  { value: "sports", label: "スポーツ" },
  { value: "conference", label: "カンファレンス" },
  { value: "festival", label: "祭り・催事" },
  { value: "other", label: "その他" },
]

const eventFormSchema = z
  .object({
    name: z.string().trim().min(1, "イベント名を入力してください").max(200, "イベント名は200文字以内で入力してください"),
    type: z.string().min(1, "種別を選択してください"),
    startDate: z.string().min(1, "開始日を選択してください"),
    endDate: z.string().min(1, "終了日を選択してください"),
    expectedImpact: z.enum(["high", "medium", "low"]),
    location: z.string().trim().max(200, "開催場所は200文字以内で入力してください"),
  })
  .refine((data) => !data.startDate || !data.endDate || data.startDate <= data.endDate, {
    path: ["endDate"],
    message: "終了日は開始日以降にしてください",
  })

export type EventFormValues = z.infer<typeof eventFormSchema>

const EMPTY_VALUES: EventFormValues = {
  name: "",
  type: "concert",
  startDate: "",
  endDate: "",
  expectedImpact: "medium",
  location: "",
}

function toFormValues(event: HotelEvent | null): EventFormValues {
  if (!event) return EMPTY_VALUES
  return {
    name: event.name,
    type: event.type,
    startDate: toDateStr(new Date(event.startDate)),
    endDate: toDateStr(new Date(event.endDate)),
    expectedImpact: (event.expectedImpact as "high" | "medium" | "low") ?? "medium",
    location: event.location ?? "",
  }
}

interface EventDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 編集対象。null なら新規登録 */
  event: HotelEvent | null
  saving: boolean
  onSubmit: (values: EventFormValues) => void | Promise<void>
}

export function EventDialog({ open, onOpenChange, event, saving, onSubmit }: EventDialogProps) {
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: EMPTY_VALUES,
    mode: "onBlur",
  })

  // ダイアログを開くたびに対象イベント（または空）で初期化する
  useEffect(() => {
    if (open) reset(toFormValues(event))
  }, [open, event, reset])

  const startDate = watch("startDate")
  const endDate = watch("endDate")
  const eventType = watch("type")
  const expectedImpact = watch("expectedImpact")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {event ? "イベント編集" : "イベント登録"}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {event
              ? "登録済みのイベント情報を編集します。"
              : "近隣で開催されるイベント情報を登録します。"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="event-name">イベント名</Label>
              <Input
                id="event-name"
                placeholder="例：○○フェスティバル"
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={errors.name ? "event-name-error" : undefined}
                {...register("name")}
              />
              <FormFieldError id="event-name-error" message={errors.name?.message} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="event-type">種別</Label>
                <Select
                  value={eventType}
                  onValueChange={(v) => setValue("type", v, { shouldValidate: true })}
                >
                  <SelectTrigger id="event-type" className="h-9 text-sm">
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
                <FormFieldError message={errors.type?.message} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="event-impact">影響度</Label>
                <Select
                  value={expectedImpact}
                  onValueChange={(v: "high" | "medium" | "low") =>
                    setValue("expectedImpact", v, { shouldValidate: true })
                  }
                >
                  <SelectTrigger id="event-impact" className="h-9 text-sm">
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

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="event-start">開始日</Label>
                <DatePicker
                  id="event-start"
                  className="h-9 w-full text-sm"
                  value={startDate ? new Date(startDate) : undefined}
                  onChange={(date) =>
                    setValue("startDate", date ? toDateStr(date) : "", { shouldValidate: true })
                  }
                  placeholder="開始日を選択"
                  ariaLabel="イベント開始日"
                />
                <FormFieldError message={errors.startDate?.message} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="event-end">終了日</Label>
                <DatePicker
                  id="event-end"
                  className="h-9 w-full text-sm"
                  value={endDate ? new Date(endDate) : undefined}
                  onChange={(date) =>
                    setValue("endDate", date ? toDateStr(date) : "", { shouldValidate: true })
                  }
                  placeholder="終了日を選択"
                  ariaLabel="イベント終了日"
                />
                <FormFieldError message={errors.endDate?.message} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="event-location">開催場所（任意）</Label>
              <Input
                id="event-location"
                placeholder="例：○○ホール"
                aria-invalid={errors.location ? true : undefined}
                {...register("location")}
              />
              <FormFieldError message={errors.location?.message} />
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              キャンセル
            </Button>
            <Button type="submit" size="sm" className="gap-2" disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Save className="h-4 w-4" aria-hidden />
              )}
              {event ? "更新" : "登録"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
