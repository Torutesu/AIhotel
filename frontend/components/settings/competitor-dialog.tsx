"use client"

// 競合ホテルの追加・編集ダイアログ（X-2 / N-2 / F-SET-03）
// OTA別URLはバックエンドが受け付ける5キーに固定する（自由入力のJSONにしない）。

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
import { FormFieldError } from "@/components/form-field-error"
import { zodResolver } from "@/lib/zod-resolver"
import type { CompetitorOtaUrls, CompetitorSetting } from "@/lib/api"

/** バックエンドが受け付けるOTAキー（F-SET-03）。これ以外のキーは 400 になる */
export const OTA_FIELDS: Array<{ key: keyof CompetitorOtaUrls; label: string }> = [
  { key: "rakuten", label: "楽天トラベル" },
  { key: "jalan", label: "じゃらん" },
  { key: "ikkyu", label: "一休.com" },
  { key: "expedia", label: "Expedia" },
  { key: "agoda", label: "Agoda" },
]

const urlField = z
  .string()
  .trim()
  .max(500, "URLは500文字以内で入力してください")
  .refine((v) => v === "" || /^https?:\/\/\S+$/.test(v), "URLの形式が不正です（http:// または https://）")

export const competitorFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "競合ホテル名を入力してください")
    .max(200, "競合ホテル名は200文字以内で入力してください"),
  category: z.string().trim().max(50, "カテゴリは50文字以内で入力してください"),
  address: z.string().trim().max(500, "住所は500文字以内で入力してください"),
  rakuten: urlField,
  jalan: urlField,
  ikkyu: urlField,
  expedia: urlField,
  agoda: urlField,
})

export type CompetitorFormValues = z.infer<typeof competitorFormSchema>

export const EMPTY_COMPETITOR_FORM: CompetitorFormValues = {
  name: "",
  category: "",
  address: "",
  rakuten: "",
  jalan: "",
  ikkyu: "",
  expedia: "",
  agoda: "",
}

/** 既存の競合をフォーム値に変換する */
export function toFormValues(competitor: CompetitorSetting): CompetitorFormValues {
  const ota = competitor.otaUrls ?? {}
  return {
    name: competitor.name,
    category: competitor.category ?? "",
    address: competitor.address ?? "",
    rakuten: ota.rakuten ?? "",
    jalan: ota.jalan ?? "",
    ikkyu: ota.ikkyu ?? "",
    expedia: ota.expedia ?? "",
    agoda: ota.agoda ?? "",
  }
}

/** フォーム値をリクエストボディへ変換する。空欄は null（登録解除）として送る */
export function toOtaUrls(values: CompetitorFormValues): CompetitorOtaUrls {
  return OTA_FIELDS.reduce<CompetitorOtaUrls>((acc, field) => {
    const raw = values[field.key].trim()
    acc[field.key] = raw === "" ? null : raw
    return acc
  }, {})
}

interface CompetitorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 編集対象。null なら新規追加 */
  competitor: CompetitorSetting | null
  saving: boolean
  onSubmit: (values: CompetitorFormValues) => void
}

export function CompetitorDialog({
  open,
  onOpenChange,
  competitor,
  saving,
  onSubmit,
}: CompetitorDialogProps) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CompetitorFormValues>({
    resolver: zodResolver(competitorFormSchema),
    defaultValues: EMPTY_COMPETITOR_FORM,
    mode: "onBlur",
  })

  // ダイアログを開くたびに対象の値へ戻す（前回の入力が残らないようにする）
  useEffect(() => {
    if (!open) return
    reset(competitor ? toFormValues(competitor) : EMPTY_COMPETITOR_FORM)
  }, [open, competitor, reset])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{competitor ? "競合ホテルを編集" : "競合ホテルを追加"}</DialogTitle>
          <DialogDescription>
            競合の基本情報とOTA別の掲載URLを登録します（OTA別URLは任意）。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto py-2 pr-1">
            <div className="space-y-2">
              <Label htmlFor="competitor-name">競合ホテル名</Label>
              <Input
                id="competitor-name"
                maxLength={200}
                aria-invalid={errors.name ? true : undefined}
                {...register("name")}
              />
              <FormFieldError message={errors.name?.message} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="competitor-category">カテゴリ</Label>
                <Input
                  id="competitor-category"
                  maxLength={50}
                  placeholder="同カテゴリ / 上位カテゴリ など"
                  aria-invalid={errors.category ? true : undefined}
                  {...register("category")}
                />
                <FormFieldError message={errors.category?.message} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="competitor-address">住所</Label>
                <Input
                  id="competitor-address"
                  maxLength={500}
                  aria-invalid={errors.address ? true : undefined}
                  {...register("address")}
                />
                <FormFieldError message={errors.address?.message} />
              </div>
            </div>

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium leading-none">OTA別URL</legend>
              <p className="text-xs text-muted-foreground">
                空欄にすると、その OTA の登録を解除します。
              </p>
              {OTA_FIELDS.map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={`competitor-${field.key}`}>{field.label}</Label>
                  <Input
                    id={`competitor-${field.key}`}
                    type="url"
                    inputMode="url"
                    placeholder="https://"
                    aria-invalid={errors[field.key] ? true : undefined}
                    {...register(field.key)}
                  />
                  <FormFieldError message={errors[field.key]?.message} />
                </div>
              ))}
            </fieldset>
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
              {competitor ? "保存" : "追加"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
