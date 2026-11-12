"use client"

// 新しいテナントの立ち上げ（運営のみ — D-13 / R-3-8）。POST /platform/tenants/provision で
// テナント・最初のホテル・テナントの管理者（ADMIN）を1回で作る（途中で失敗したら何も残らない）。
// 管理者へのログイン案内はメールで送る。メールで送れなかったときだけ、初回のパスワードを画面に1回だけ出す。

import { useState, type ComponentProps } from "react"
import { useForm } from "react-hook-form"
import { CheckCircle2, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { FormFieldError } from "@/components/form-field-error"
import { OneTimePasswordField } from "@/components/settings/one-time-password"
import { api, ApiClientError, type ProvisionTenantRequest, type ProvisionTenantResult } from "@/lib/api"
import { DAY_NAMES, DEFAULT_WEEKEND_DAYS } from "@/lib/date"
import { PREFECTURES } from "@/lib/prefectures"
import { zodResolver } from "@/lib/zod-resolver"
import { HOTEL_TYPE_LABELS, type HotelType } from "@shared/types"

const SELECT_CLASS = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm"

/** backend の createTenantSchema と同じ制約（テナント名・コード） */
export const tenantNameSchema = z.string().trim().min(1, "テナント名を入力してください").max(200)
export const tenantCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/, "小文字英数字とハイフンの3〜50文字で入力してください")

/** backend の provisionTenantSchema と同じ制約 */
export const provisionFormSchema = z.object({
  tenantName: tenantNameSchema,
  tenantCode: tenantCodeSchema,
  adminName: z.string().trim().min(1, "氏名を入力してください").max(100, "氏名は100文字以内で入力してください"),
  adminEmail: z.string().trim().toLowerCase().email("有効なメールアドレスを入力してください"),
  hotelName: z.string().trim().min(1, "ホテル名を入力してください").max(200, "ホテル名は200文字以内で入力してください"),
  totalRooms: z
    .string()
    .trim()
    .refine((v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 100000, { message: "客室数は1以上の整数で入力してください" }),
  hotelType: z.string(),
  prefectureCode: z.string(),
  openedOn: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), { message: "開業日は YYYY-MM-DD 形式で入力してください" }),
  saleOpenDaysBefore: z
    .string()
    .trim()
    .refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 540), {
      message: "販売開始は 1〜540 の整数（宿泊日の何日前）で入力してください",
    }),
})
export type ProvisionFormValues = z.infer<typeof provisionFormSchema>

const DEFAULT_VALUES: ProvisionFormValues = {
  tenantName: "",
  tenantCode: "",
  adminName: "",
  adminEmail: "",
  hotelName: "",
  totalRooms: "",
  hotelType: "",
  prefectureCode: "",
  openedOn: "",
  saleOpenDaysBefore: "",
}

/** フォームの値を API のリクエストにする */
export function toProvisionRequest(values: ProvisionFormValues, weekendDays: number[]): ProvisionTenantRequest {
  return {
    tenant: { name: values.tenantName, code: values.tenantCode },
    admin: { email: values.adminEmail, name: values.adminName },
    hotel: {
      name: values.hotelName,
      totalRooms: Number(values.totalRooms),
      hotelType: values.hotelType === "" ? null : (values.hotelType as HotelType),
      prefectureCode: values.prefectureCode || null,
      openedOn: values.openedOn || null,
      saleOpenDaysBefore: values.saleOpenDaysBefore === "" ? null : Number(values.saleOpenDaysBefore),
      weekendDays,
    },
  }
}

interface TenantProvisionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 立ち上げが終わったあと（テナント一覧の再読込） */
  onProvisioned?: (result: ProvisionTenantResult) => void
}

export function TenantProvisionDialog({ open, onOpenChange, onProvisioned }: TenantProvisionDialogProps) {
  const [saving, setSaving] = useState(false)
  const [weekendDays, setWeekendDays] = useState<number[]>(DEFAULT_WEEKEND_DAYS)
  const [result, setResult] = useState<ProvisionTenantResult | null>(null)
  const form = useForm<ProvisionFormValues>({
    resolver: zodResolver(provisionFormSchema),
    defaultValues: DEFAULT_VALUES,
    mode: "onBlur",
  })
  const errors = form.formState.errors

  const close = () => {
    // 閉じたら一時パスワードを含む結果を残さない
    setResult(null)
    form.reset(DEFAULT_VALUES)
    setWeekendDays(DEFAULT_WEEKEND_DAYS)
    onOpenChange(false)
  }

  const submit = async (values: ProvisionFormValues) => {
    if (weekendDays.length === 0) {
      toast.error("週末として扱う曜日を1つ以上選択してください")
      return
    }
    setSaving(true)
    try {
      const created = await api.provisionTenant(toProvisionRequest(values, weekendDays))
      setResult(created)
      toast.success(`テナント「${created.tenant.name}」を立ち上げました`)
      onProvisioned?.(created)
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "テナントの立ち上げに失敗しました")
    } finally {
      setSaving(false)
    }
  }

  const field = (name: keyof ProvisionFormValues, label: string, props: ComponentProps<typeof Input> = {}, help?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`provision-${name}`}>{label}</Label>
      <Input id={`provision-${name}`} aria-invalid={errors[name] ? true : undefined} {...props} {...form.register(name)} />
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
      <FormFieldError message={errors[name]?.message} />
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
        {result ? (
          <ProvisionResultView result={result} onClose={close} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>新しいテナントの立ち上げ</DialogTitle>
              <DialogDescription>
                テナント・最初のホテル・テナントの管理者を1回で作ります。途中で失敗したときは何も作られません。
                管理者にはログインの案内をメールで送ります。
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={form.handleSubmit(submit)} noValidate className="space-y-4">
              <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <legend className="mb-1 text-sm font-medium">テナント</legend>
                {field("tenantName", "テナント名")}
                {field("tenantCode", "コード", { placeholder: "例: fujita-kanko" })}
              </fieldset>
              <Separator />
              <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <legend className="mb-1 text-sm font-medium">管理者</legend>
                {field("adminName", "氏名")}
                {field("adminEmail", "メールアドレス", { type: "email", autoComplete: "off" })}
              </fieldset>
              <Separator />
              <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <legend className="mb-1 text-sm font-medium">最初のホテル</legend>
                {field("hotelName", "ホテル名")}
                {field("totalRooms", "客室数", { inputMode: "numeric", placeholder: "例: 120" })}
                <div className="space-y-1.5">
                  <Label htmlFor="provision-hotelType">ホテルタイプ</Label>
                  <select id="provision-hotelType" className={SELECT_CLASS} {...form.register("hotelType")}>
                    <option value="">未設定</option>
                    {(Object.keys(HOTEL_TYPE_LABELS) as HotelType[]).map((type) => (
                      <option key={type} value={type}>
                        {HOTEL_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="provision-prefectureCode">都道府県</Label>
                  <select id="provision-prefectureCode" className={SELECT_CLASS} {...form.register("prefectureCode")}>
                    <option value="">未設定</option>
                    {PREFECTURES.map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                {field("openedOn", "開業日（任意）", { type: "date" }, "開業1年未満なら、予測を開業からの日数に合わせます")}
                {field("saleOpenDaysBefore", "販売開始（宿泊日の何日前・任意）", { inputMode: "numeric", placeholder: "例: 330" })}
                <div className="space-y-1.5 sm:col-span-2">
                  <span className="text-sm font-medium">週末として扱う曜日</span>
                  <div className="flex flex-wrap gap-3 pt-1">
                    {DAY_NAMES.map((label, day) => (
                      <div key={day} className="flex items-center gap-1.5">
                        <Checkbox
                          id={`provision-weekend-${day}`}
                          checked={weekendDays.includes(day)}
                          onCheckedChange={(checked) =>
                            setWeekendDays((prev) =>
                              checked === true ? [...new Set([...prev, day])].sort((a, b) => a - b) : prev.filter((d) => d !== day),
                            )
                          }
                        />
                        <Label htmlFor={`provision-weekend-${day}`} className="font-normal">
                          {label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
              </fieldset>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={close} disabled={saving}>
                  やめる
                </Button>
                <Button type="submit" disabled={saving} className="gap-2">
                  {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  立ち上げる
                </Button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** 立ち上げの結果。メールで送れなかったときだけ初回のパスワードを1回だけ出す */
export function ProvisionResultView({ result, onClose }: { result: ProvisionTenantResult; onClose: () => void }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-positive" aria-hidden />
          テナントを立ち上げました
        </DialogTitle>
        <DialogDescription>次のテナント・ホテル・管理者を作りました。</DialogDescription>
      </DialogHeader>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">テナント</dt>
        <dd>
          {result.tenant.name}（{result.tenant.code}）
        </dd>
        <dt className="text-muted-foreground">ホテル</dt>
        <dd>{result.hotel.name}</dd>
        <dt className="text-muted-foreground">管理者</dt>
        <dd>
          {result.admin.name}（{result.admin.email}）
        </dd>
      </dl>
      {result.temporaryPassword ? (
        <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3" role="alert">
          <p className="text-sm font-medium text-warning">初回のパスワードは今だけ表示します。この画面を閉じると再表示できません。</p>
          <p className="text-xs text-muted-foreground">
            メールで送れなかったため画面に表示しています。管理者に安全な方法で伝えてください。本人は初回ログイン時に新しいパスワードを設定します。
          </p>
          <OneTimePasswordField password={result.temporaryPassword} label="初回のパスワード" />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {result.emailSent ? "管理者にログインの案内をメールで送りました。" : "管理者へのログインの案内は送られていません。必要ならユーザー管理から一時パスワードを発行してください。"}
        </p>
      )}
      <div className="flex justify-end">
        <Button size="sm" onClick={onClose}>
          閉じる
        </Button>
      </div>
    </>
  )
}
