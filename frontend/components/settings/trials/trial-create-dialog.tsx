"use client"

// トライアルの発行ダイアログ（運営）。名前・種別・期間・メモ・ログイン ID（任意）を入れる。
// backend の createTrialSchema と同じ制約で検証する。

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { Loader2, Plus } from "lucide-react"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { FormFieldError } from "@/components/form-field-error"
import { zodResolver } from "@/lib/zod-resolver"
import { TRIAL_KIND_LABELS, type CreateTrialRequest, type TrialKind } from "@shared/types"

export const trialFormSchema = z.object({
  name: z.string().trim().min(1, "名前を入力してください").max(100, "100文字以内で入力してください"),
  kind: z.enum(["DEALER", "PROSPECT_HOTEL"]),
  days: z.coerce
    .number({ invalid_type_error: "日数を入力してください" })
    .int("整数で入力してください")
    .min(1, "1日以上にしてください")
    .max(90, "90日以内にしてください"),
  note: z.string().trim().max(500, "500文字以内で入力してください"),
  // 空欄なら自動で作る
  loginEmail: z.union([z.literal(""), z.string().trim().email("有効なメールアドレスを入力してください")]),
})
export type TrialFormValues = z.infer<typeof trialFormSchema>

const DEFAULTS: TrialFormValues = { name: "", kind: "DEALER", days: 30, note: "", loginEmail: "" }

export function toCreateTrialRequest(values: TrialFormValues): CreateTrialRequest {
  return {
    name: values.name.trim(),
    kind: values.kind,
    days: values.days,
    ...(values.note.trim() !== "" && { note: values.note.trim() }),
    ...(values.loginEmail.trim() !== "" && { loginEmail: values.loginEmail.trim().toLowerCase() }),
  }
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  saving: boolean
  onSubmit: (values: TrialFormValues) => void
}

export function TrialCreateDialog({ open, onOpenChange, saving, onSubmit }: Props) {
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<TrialFormValues>({ resolver: zodResolver(trialFormSchema), defaultValues: DEFAULTS, mode: "onBlur" })

  useEffect(() => {
    if (open) reset(DEFAULTS)
  }, [open, reset])

  const kind = watch("kind")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>トライアルを発行</DialogTitle>
          <DialogDescription>
            デモデータ入りの専用ホテルとログイン ID を作ります。ほかのトライアルや本番の顧客のデータには影響しません。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="trial-name">渡し先の名前</Label>
            <Input id="trial-name" placeholder="例: ○○販売店、△△ホテル様" maxLength={100} {...register("name")} />
            <FormFieldError message={errors.name?.message} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="trial-kind">種別</Label>
              <Select value={kind} onValueChange={(v) => setValue("kind", v as TrialKind, { shouldValidate: true })}>
                <SelectTrigger id="trial-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TRIAL_KIND_LABELS) as TrialKind[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {TRIAL_KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="trial-days">期間（日）</Label>
              <Input id="trial-days" type="number" min={1} max={90} {...register("days")} />
              <FormFieldError message={errors.days?.message} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="trial-login">ログイン ID（任意）</Label>
            <Input id="trial-login" type="email" autoComplete="off" placeholder="空欄なら自動で作ります" {...register("loginEmail")} />
            <FormFieldError message={errors.loginEmail?.message} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="trial-note">メモ（任意）</Label>
            <Textarea id="trial-note" rows={2} placeholder="例: 担当 山田様、10/5 商談" {...register("note")} />
            <FormFieldError message={errors.note?.message} />
          </div>
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              キャンセル
            </Button>
            <Button type="submit" size="sm" className="gap-2" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
              発行する
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
