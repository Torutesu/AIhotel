"use client"

// ホテル情報設定（U-11 / U-15 / F-SET-01）
// 総客室数・メール・電話番号の検証を zod + react-hook-form でインライン表示する。
// 週末定義は Hotel.weekendDays としてここでのみ編集し、保存後は AuthProvider に反映する。

import { useCallback, useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { Loader2, Save } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/error-state"
import { FormFieldError } from "@/components/form-field-error"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { useAuth } from "@/components/auth-provider"
import { api, ApiClientError, type Hotel } from "@/lib/api"
import { DAY_NAMES, DEFAULT_WEEKEND_DAYS, parseWeekendDays } from "@/lib/date"
import { zodResolver } from "@/lib/zod-resolver"
import { canManage as canManageRole } from "@shared/types"

/** 電話番号（日本の固定・携帯を想定した緩めの検証。数字・ハイフン・括弧・+ のみ） */
const PHONE_PATTERN = /^[0-9+\-()\s]{10,20}$/

const hotelFormSchema = z.object({
  name: z.string().trim().min(1, "ホテル名を入力してください").max(200, "ホテル名は200文字以内で入力してください"),
  address: z.string().trim().max(300, "住所は300文字以内で入力してください"),
  totalRooms: z
    .number({ invalid_type_error: "総客室数は数値で入力してください" })
    .int("総客室数は整数で入力してください")
    .min(1, "総客室数は1以上で入力してください")
    .max(100000, "総客室数が大きすぎます"),
  email: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === "" || z.string().email().safeParse(v).success, {
      message: "メールアドレスの形式が正しくありません",
    }),
  phone: z
    .string()
    .trim()
    .refine((v) => v === "" || PHONE_PATTERN.test(v), {
      message: "電話番号は数字とハイフンで入力してください（例: 03-1234-5678）",
    }),
})

type HotelFormValues = z.infer<typeof hotelFormSchema>

function toFormValues(hotel: Hotel): HotelFormValues {
  return {
    name: hotel.name,
    address: hotel.address ?? "",
    totalRooms: hotel.totalRooms,
    email: hotel.email ?? "",
    phone: hotel.phone ?? "",
  }
}

export function HotelSettingsCard() {
  const { hotelId, user, setHotel: setAuthHotel } = useAuth()
  const canManage = canManageRole(user?.role)

  const [hotel, setHotel] = useState<Hotel | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [weekendDays, setWeekendDays] = useState<number[]>(DEFAULT_WEEKEND_DAYS)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<HotelFormValues>({
    resolver: zodResolver(hotelFormSchema),
    defaultValues: { name: "", address: "", totalRooms: 1, email: "", phone: "" },
    mode: "onBlur",
  })

  const load = useCallback(async () => {
    if (!hotelId) return
    setLoading(true)
    setError(null)
    try {
      const hotels = await api.hotels()
      const found = hotels.find((h) => h.id === hotelId) ?? null
      if (!found) throw new ApiClientError(404, "ホテル情報が見つかりません")
      setHotel(found)
      reset(toFormValues(found))
      setWeekendDays(parseWeekendDays(found.weekendDays))
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "ホテル情報の取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [hotelId, reset])

  useEffect(() => {
    load()
  }, [load])

  const toggleWeekendDay = (day: number, checked: boolean) => {
    setWeekendDays((prev) => {
      if (checked) return prev.includes(day) ? prev : [...prev, day].sort((a, b) => a - b)
      return prev.filter((d) => d !== day)
    })
  }

  const onSubmit = async (values: HotelFormValues) => {
    if (!hotelId) return
    if (weekendDays.length === 0) {
      toast.error("週末として扱う曜日を1つ以上選択してください")
      return
    }
    setSaving(true)
    try {
      const updated = await api.updateHotelSettings(hotelId, {
        name: values.name.trim(),
        address: values.address.trim(),
        email: values.email.trim(),
        phone: values.phone.trim(),
        totalRooms: values.totalRooms,
        weekendDays,
      })
      setHotel(updated)
      reset(toFormValues(updated))
      setWeekendDays(parseWeekendDays(updated.weekendDays))
      // 週末定義などは AuthProvider が全画面へ配っているため、保存後に差し替える（U-6）
      setAuthHotel(updated)
      toast.success("ホテル設定を保存しました")
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "ホテル設定の保存に失敗しました")
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    if (!hotel) return
    reset(toFormValues(hotel))
    setWeekendDays(parseWeekendDays(hotel.weekendDays))
    toast.success("入力内容を保存済みの値に戻しました")
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>ホテル情報</CardTitle>
            <CardDescription>
              ホテルの基本情報を設定します
              {!canManage && "（変更にはMANAGER以上の権限が必要です）"}
            </CardDescription>
          </div>
          {canManage && !loading && !error && (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setResetConfirmOpen(true)}
                disabled={saving || !hotel}
              >
                元に戻す
              </Button>
              <Button
                type="submit"
                form="hotel-settings-form"
                size="sm"
                className="gap-2"
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Save className="h-4 w-4" aria-hidden />
                )}
                保存
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : (
          <form id="hotel-settings-form" onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="hotelName">ホテル名</Label>
                <Input
                  id="hotelName"
                  placeholder="ホテル名を入力"
                  disabled={!canManage}
                  aria-invalid={errors.name ? true : undefined}
                  {...register("name")}
                />
                <FormFieldError message={errors.name?.message} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="totalRooms">総客室数</Label>
                <Input
                  id="totalRooms"
                  type="number"
                  min={1}
                  placeholder="200"
                  disabled={!canManage}
                  aria-invalid={errors.totalRooms ? true : undefined}
                  {...register("totalRooms", { valueAsNumber: true })}
                />
                <FormFieldError message={errors.totalRooms?.message} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="hotelAddress">住所</Label>
                <Input
                  id="hotelAddress"
                  placeholder="住所を入力"
                  disabled={!canManage}
                  {...register("address")}
                />
                <FormFieldError message={errors.address?.message} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contactEmail">連絡先メールアドレス</Label>
                <Input
                  id="contactEmail"
                  type="email"
                  placeholder="contact@hotel.example.com"
                  disabled={!canManage}
                  aria-invalid={errors.email ? true : undefined}
                  {...register("email")}
                />
                <FormFieldError message={errors.email?.message} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contactPhone">連絡先電話番号</Label>
                <Input
                  id="contactPhone"
                  placeholder="03-1234-5678"
                  disabled={!canManage}
                  aria-invalid={errors.phone ? true : undefined}
                  {...register("phone")}
                />
                <FormFieldError message={errors.phone?.message} />
              </div>
            </div>

            <Separator />

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">週末定義</legend>
              <p className="text-sm text-muted-foreground">
                稼働率・ADR等の集計と画面の強調表示で「週末」として扱う曜日を選択します（デフォルト: 金・土）
              </p>
              <div className="flex flex-wrap gap-4 pt-1">
                {DAY_NAMES.map((label, day) => (
                  <div key={day} className="flex items-center gap-2">
                    <Checkbox
                      id={`weekend-day-${day}`}
                      checked={weekendDays.includes(day)}
                      onCheckedChange={(checked) => toggleWeekendDay(day, checked === true)}
                      disabled={!canManage}
                    />
                    <Label htmlFor={`weekend-day-${day}`} className="font-normal">
                      {label}曜日
                    </Label>
                  </div>
                ))}
              </div>
              {weekendDays.length === 0 && (
                <FormFieldError message="週末として扱う曜日を1つ以上選択してください" />
              )}
            </fieldset>
          </form>
        )}
      </CardContent>

      <ConfirmDialog
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        title="入力内容を元に戻しますか？"
        description="編集中の内容を破棄し、保存済みのホテル設定に戻します。"
        confirmLabel="元に戻す"
        onConfirm={() => {
          setResetConfirmOpen(false)
          handleReset()
        }}
      />
    </Card>
  )
}
