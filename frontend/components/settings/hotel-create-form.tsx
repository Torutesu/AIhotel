"use client"

// ホテル作成フォーム（#81）。ホテルが0件のときの初期設定画面と、設定タブのホテル管理で共用する。
// 制約は backend の createHotelSchema と同じ（backend/src/lib/validators.ts）。

import { useForm } from "react-hook-form"
import { Loader2, Plus } from "lucide-react"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormFieldError } from "@/components/form-field-error"
import { zodResolver } from "@/lib/zod-resolver"

export const hotelCreateSchema = z.object({
  name: z.string().trim().min(1, "ホテル名を入力してください").max(200, "ホテル名は200文字以内で入力してください"),
  totalRooms: z.coerce
    .number({ invalid_type_error: "客室数を数字で入力してください" })
    .int("客室数は整数で入力してください")
    .min(1, "客室数は1以上で入力してください")
    .max(100000, "客室数が大きすぎます"),
  address: z.string().trim().max(500, "住所は500文字以内で入力してください"),
})

export type HotelCreateValues = z.infer<typeof hotelCreateSchema>

interface HotelCreateFormProps {
  saving: boolean
  onSubmit: (values: HotelCreateValues) => void
  submitLabel?: string
  /** 同じ画面に複数置いても id が衝突しないようにする */
  idPrefix?: string
}

export function HotelCreateForm({
  saving,
  onSubmit,
  submitLabel = "ホテルを作成",
  idPrefix = "hotel-create",
}: HotelCreateFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<HotelCreateValues>({
    resolver: zodResolver(hotelCreateSchema),
    defaultValues: { name: "", totalRooms: undefined as unknown as number, address: "" },
    mode: "onBlur",
  })

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-name`}>ホテル名</Label>
        <Input id={`${idPrefix}-name`} maxLength={200} aria-invalid={errors.name ? true : undefined} {...register("name")} />
        <FormFieldError message={errors.name?.message} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-rooms`}>客室数</Label>
        <Input
          id={`${idPrefix}-rooms`}
          type="number"
          inputMode="numeric"
          min={1}
          aria-invalid={errors.totalRooms ? true : undefined}
          {...register("totalRooms")}
        />
        <p className="text-xs text-muted-foreground">稼働率・RevPAR の分母になります。販売可能な総客室数を入力してください。</p>
        <FormFieldError message={errors.totalRooms?.message} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-address`}>住所（任意）</Label>
        <Input id={`${idPrefix}-address`} maxLength={500} {...register("address")} />
        <FormFieldError message={errors.address?.message} />
      </div>
      <Button type="submit" disabled={saving} className="gap-2">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
        {submitLabel}
      </Button>
    </form>
  )
}
