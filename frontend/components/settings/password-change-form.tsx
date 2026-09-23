"use client"

// パスワード変更フォーム（#89）。設定タブと、一時パスワードでログインした直後の画面で共用する。
// 強度のルールは backend の passwordSchema と同じ。

import { useState } from "react"
import { useForm } from "react-hook-form"
import { KeyRound, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormFieldError } from "@/components/form-field-error"
import { useAuth } from "@/components/auth-provider"
import { api, ApiClientError } from "@/lib/api"
import { zodResolver } from "@/lib/zod-resolver"

const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "現在のパスワードを入力してください"),
    newPassword: z
      .string()
      .min(8, "8文字以上で入力してください")
      .max(128, "128文字以内で入力してください")
      .regex(/[A-Z]/, "大文字を含めてください")
      .regex(/[a-z]/, "小文字を含めてください")
      .regex(/[0-9]/, "数字を含めてください"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "確認用のパスワードが一致しません",
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "現在と同じパスワードは使えません",
  })

type PasswordChangeValues = z.infer<typeof passwordChangeSchema>

export function PasswordChangeForm({ currentLabel = "現在のパスワード" }: { currentLabel?: string }) {
  const { replaceUser } = useAuth()
  const [saving, setSaving] = useState(false)
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<PasswordChangeValues>({
    resolver: zodResolver(passwordChangeSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
    mode: "onBlur",
  })

  const onSubmit = async (values: PasswordChangeValues) => {
    setSaving(true)
    try {
      const user = await api.changePassword(values.currentPassword, values.newPassword)
      await replaceUser(user)
      reset()
      toast.success("パスワードを変更しました", { description: "ほかの端末ではログアウトされました。" })
    } catch (err) {
      if (err instanceof ApiClientError && err.fieldErrors.some((e) => e.field === "currentPassword")) {
        setError("currentPassword", { message: "現在のパスワードが正しくありません" })
      } else {
        toast.error(err instanceof ApiClientError ? err.message : "パスワードの変更に失敗しました")
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="max-w-md space-y-4">
      <div className="space-y-2">
        <Label htmlFor="current-password">{currentLabel}</Label>
        <Input id="current-password" type="password" autoComplete="current-password" {...register("currentPassword")} />
        <FormFieldError message={errors.currentPassword?.message} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="new-password">新しいパスワード</Label>
        <Input id="new-password" type="password" autoComplete="new-password" {...register("newPassword")} />
        <p className="text-xs text-muted-foreground">8文字以上で、大文字・小文字・数字をそれぞれ1文字以上含めてください。</p>
        <FormFieldError message={errors.newPassword?.message} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm-password">新しいパスワード（確認）</Label>
        <Input id="confirm-password" type="password" autoComplete="new-password" {...register("confirmPassword")} />
        <FormFieldError message={errors.confirmPassword?.message} />
      </div>
      <Button type="submit" disabled={saving} className="gap-2">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />}
        パスワードを変更
      </Button>
    </form>
  )
}
