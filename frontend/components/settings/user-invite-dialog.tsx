"use client"

// ユーザー招待ダイアログ（X-3 / N-3）
// POST /auth/register を呼ぶ。zod スキーマは backend の registerSchema と同じ制約にする。

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { Loader2, UserPlus } from "lucide-react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FormFieldError } from "@/components/form-field-error"
import { zodResolver } from "@/lib/zod-resolver"
import type { Hotel } from "@/lib/api"
import type { UserRole } from "@shared/types"

/** ADMIN が「ホテル指定なし（テナント横断ユーザー）」を選ぶときの番兵値 */
export const NO_HOTEL_VALUE = "__none__"

/** backend の registerSchema と同じ制約（backend/src/lib/validators.ts） */
export const inviteFormSchema = z.object({
  email: z.string().trim().email("有効なメールアドレスを入力してください"),
  name: z
    .string()
    .trim()
    .min(1, "名前を入力してください")
    .max(100, "名前は100文字以内で入力してください"),
  password: z
    .string()
    .min(8, "パスワードは8文字以上で入力してください")
    .regex(/[A-Z]/, "大文字を含めてください")
    .regex(/[a-z]/, "小文字を含めてください")
    .regex(/[0-9]/, "数字を含めてください"),
  role: z.enum(["ADMIN", "MANAGER", "OPERATOR"]),
  hotelId: z.string(),
})

export type InviteFormValues = z.infer<typeof inviteFormSchema>

interface UserInviteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 選択できるロール（MANAGER には ADMIN を出さない） */
  roleOptions: Array<{ value: UserRole; label: string }>
  /** 選択できるホテル（アクセスできるホテルのみ） */
  hotels: Hotel[]
  /** ホテル指定なし（テナント横断ユーザー）を選べるか。ADMIN のみ */
  allowNoHotel: boolean
  /** 初期選択のホテルID */
  defaultHotelId: string | null
  saving: boolean
  onSubmit: (values: InviteFormValues) => void
}

export function UserInviteDialog({
  open,
  onOpenChange,
  roleOptions,
  hotels,
  allowNoHotel,
  defaultHotelId,
  saving,
  onSubmit,
}: UserInviteDialogProps) {
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<InviteFormValues>({
    resolver: zodResolver(inviteFormSchema),
    defaultValues: {
      email: "",
      name: "",
      password: "",
      role: "OPERATOR",
      hotelId: defaultHotelId ?? NO_HOTEL_VALUE,
    },
    mode: "onBlur",
  })

  useEffect(() => {
    if (!open) return
    reset({
      email: "",
      name: "",
      password: "",
      role: "OPERATOR",
      hotelId: defaultHotelId ?? NO_HOTEL_VALUE,
    })
  }, [open, defaultHotelId, reset])

  const role = watch("role")
  const hotelId = watch("hotelId")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>ユーザーを招待</DialogTitle>
          <DialogDescription>
            指定したメールアドレスとパスワードでログインできるユーザーを作成します。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="invite-name">名前</Label>
              <Input
                id="invite-name"
                maxLength={100}
                aria-invalid={errors.name ? true : undefined}
                {...register("name")}
              />
              <FormFieldError message={errors.name?.message} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="invite-email">メールアドレス</Label>
              <Input
                id="invite-email"
                type="email"
                autoComplete="off"
                aria-invalid={errors.email ? true : undefined}
                {...register("email")}
              />
              <FormFieldError message={errors.email?.message} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="invite-password">初期パスワード</Label>
              <Input
                id="invite-password"
                type="password"
                autoComplete="new-password"
                aria-invalid={errors.password ? true : undefined}
                {...register("password")}
              />
              <p className="text-xs text-muted-foreground">
                8文字以上で、大文字・小文字・数字をそれぞれ1文字以上含めてください。
              </p>
              <FormFieldError message={errors.password?.message} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="invite-role">ロール</Label>
                <Select
                  value={role}
                  onValueChange={(v) => setValue("role", v as UserRole, { shouldValidate: true })}
                >
                  <SelectTrigger id="invite-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roleOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormFieldError message={errors.role?.message} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="invite-hotel">所属ホテル</Label>
                <Select
                  value={hotelId}
                  onValueChange={(v) => setValue("hotelId", v, { shouldValidate: true })}
                >
                  <SelectTrigger id="invite-hotel">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {hotels.map((h) => (
                      <SelectItem key={h.id} value={h.id}>
                        {h.name}
                      </SelectItem>
                    ))}
                    {allowNoHotel && (
                      <SelectItem value={NO_HOTEL_VALUE}>指定なし（テナント横断）</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <FormFieldError message={errors.hotelId?.message} />
              </div>
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
                <UserPlus className="h-4 w-4" aria-hidden />
              )}
              招待する
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
