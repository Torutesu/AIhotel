"use client"

// 周辺の新規ホテルの登録・編集フォーム（外部需要動向 — 2026-10）。
// 入力検証は zod + react-hook-form でインライン表示する（バックエンドの createNewHotelSchema と同じ条件）。

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { Loader2, Save } from "lucide-react"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { FormFieldError } from "@/components/form-field-error"
import { zodResolver } from "@/lib/zod-resolver"
import type { NewHotelInput, NewHotelOpening } from "@/lib/api"

const optionalNumber = (message: string, check: (n: number) => boolean) =>
  z.string().trim().refine((v) => v === "" || (Number.isFinite(Number(v)) && check(Number(v))), message)

export const newHotelFormSchema = z.object({
  name: z.string().trim().min(1, "ホテル名を入力してください").max(200, "ホテル名は200文字以内で入力してください"),
  openingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "開業日を入力してください"),
  rooms: optionalNumber("客室数は1以上の整数で入力してください", (n) => Number.isInteger(n) && n >= 1 && n <= 10000),
  category: z.string().trim().max(50, "カテゴリは50文字以内で入力してください"),
  location: z.string().trim().max(200, "所在地は200文字以内で入力してください"),
  distanceKm: optionalNumber("距離は0以上の数値（km）で入力してください", (n) => n >= 0 && n <= 1000),
  expectedImpact: z.enum(["none", "high", "medium", "low"]),
  notes: z.string().trim().max(2000, "メモは2000文字以内で入力してください"),
})

export type NewHotelFormValues = z.infer<typeof newHotelFormSchema>

const EMPTY: NewHotelFormValues = {
  name: "",
  openingDate: "",
  rooms: "",
  category: "",
  location: "",
  distanceKm: "",
  expectedImpact: "none",
  notes: "",
}

function toFormValues(hotel: NewHotelOpening | null): NewHotelFormValues {
  if (!hotel) return EMPTY
  return {
    name: hotel.name,
    openingDate: hotel.openingDate.slice(0, 10),
    rooms: hotel.rooms == null ? "" : String(hotel.rooms),
    category: hotel.category ?? "",
    location: hotel.location ?? "",
    distanceKm: hotel.distanceKm == null ? "" : String(hotel.distanceKm),
    expectedImpact: hotel.expectedImpact ?? "none",
    notes: hotel.notes ?? "",
  }
}

/** フォームの値を API の入力に直す（純関数） */
export function toNewHotelInput(values: NewHotelFormValues): NewHotelInput {
  const num = (v: string) => (v.trim() === "" ? null : Number(v))
  return {
    name: values.name.trim(),
    openingDate: values.openingDate,
    rooms: num(values.rooms),
    category: values.category.trim() || null,
    location: values.location.trim() || null,
    distanceKm: num(values.distanceKm),
    expectedImpact: values.expectedImpact === "none" ? null : values.expectedImpact,
    notes: values.notes.trim() || null,
  }
}

interface NewHotelFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 編集対象。null なら新規登録 */
  hotel: NewHotelOpening | null
  saving: boolean
  onSubmit: (input: NewHotelInput) => void | Promise<void>
}

export function NewHotelFormDialog({ open, onOpenChange, hotel, saving, onSubmit }: NewHotelFormDialogProps) {
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<NewHotelFormValues>({ resolver: zodResolver(newHotelFormSchema), defaultValues: EMPTY, mode: "onBlur" })

  useEffect(() => {
    if (open) reset(toFormValues(hotel))
  }, [open, hotel, reset])

  const impact = watch("expectedImpact")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{hotel ? "新規ホテルの編集" : "新規ホテルの登録"}</DialogTitle>
          <DialogDescription>周辺で開業する（した）ホテルを登録します。供給が増える時期の需要の見通しに使います。</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit((values) => onSubmit(toNewHotelInput(values)))} noValidate>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="new-hotel-name">ホテル名</Label>
              <Input id="new-hotel-name" placeholder="例：ステーションホテル新館" aria-invalid={errors.name ? true : undefined} {...register("name")} />
              <FormFieldError message={errors.name?.message} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new-hotel-opening">開業日</Label>
                <Input id="new-hotel-opening" type="date" aria-invalid={errors.openingDate ? true : undefined} {...register("openingDate")} />
                <FormFieldError message={errors.openingDate?.message} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-hotel-rooms">客室数（任意）</Label>
                <Input id="new-hotel-rooms" inputMode="numeric" placeholder="例：220" aria-invalid={errors.rooms ? true : undefined} {...register("rooms")} />
                <FormFieldError message={errors.rooms?.message} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="new-hotel-category">カテゴリ（任意）</Label>
                <Input id="new-hotel-category" placeholder="例：ビジネス・シティ・リゾート" {...register("category")} />
                <FormFieldError message={errors.category?.message} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-hotel-impact">影響度（任意）</Label>
                <Select value={impact} onValueChange={(v: NewHotelFormValues["expectedImpact"]) => setValue("expectedImpact", v)}>
                  <SelectTrigger id="new-hotel-impact" className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未設定</SelectItem>
                    <SelectItem value="high">高</SelectItem>
                    <SelectItem value="medium">中</SelectItem>
                    <SelectItem value="low">低</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_140px]">
              <div className="space-y-2">
                <Label htmlFor="new-hotel-location">所在地（任意）</Label>
                <Input id="new-hotel-location" placeholder="例：駅北口" {...register("location")} />
                <FormFieldError message={errors.location?.message} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-hotel-distance">距離 km（任意）</Label>
                <Input id="new-hotel-distance" inputMode="decimal" placeholder="例：0.4" aria-invalid={errors.distanceKm ? true : undefined} {...register("distanceKm")} />
                <FormFieldError message={errors.distanceKm?.message} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-hotel-notes">メモ（任意）</Label>
              <Textarea id="new-hotel-notes" rows={2} placeholder="例：同価格帯。開業月は割引販売の見込み" {...register("notes")} />
              <FormFieldError message={errors.notes?.message} />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              キャンセル
            </Button>
            <Button type="submit" size="sm" className="gap-2" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
              {hotel ? "更新" : "登録"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
