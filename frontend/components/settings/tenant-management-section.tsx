"use client"

// テナント管理（運営 = PLATFORM_ADMIN 専用 — #81）
// テナントの一覧・作成・契約停止／再開と、テナントの最初の管理者（ADMIN）の作成。
// 停止すると所属ユーザーは次のリクエストからログアウトされる（#78）。

import { useCallback, useEffect, useState } from "react"
import { Loader2, Pause, Play, Plus, UserPlus } from "lucide-react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { ErrorState } from "@/components/error-state"
import { FormFieldError } from "@/components/form-field-error"
import { initialPasswordSchema, inviteFormSchema } from "@/components/settings/user-invite-dialog"
import { api, ApiClientError, type TenantSummary } from "@/lib/api"
import { zodResolver } from "@/lib/zod-resolver"

/** backend の createTenantSchema と同じ制約 */
const tenantFormSchema = z.object({
  name: z.string().trim().min(1, "テナント名を入力してください").max(200),
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/, "小文字英数字とハイフンの3〜50文字で入力してください"),
})
type TenantFormValues = z.infer<typeof tenantFormSchema>

// 新しいテナントの最初の管理者は、運営が初期パスワードを決めて伝える（招待の空欄は許さない）
const adminFormSchema = inviteFormSchema.pick({ name: true, email: true }).extend({ password: initialPasswordSchema })
type AdminFormValues = z.infer<typeof adminFormSchema>

export function TenantManagementSection() {
  const [tenants, setTenants] = useState<TenantSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [adminTarget, setAdminTarget] = useState<TenantSummary | null>(null)
  const [toggleTarget, setToggleTarget] = useState<TenantSummary | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setTenants(await api.tenants())
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "テナントの取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const tenantForm = useForm<TenantFormValues>({
    resolver: zodResolver(tenantFormSchema),
    defaultValues: { name: "", code: "" },
    mode: "onBlur",
  })
  const adminForm = useForm<AdminFormValues>({
    resolver: zodResolver(adminFormSchema),
    defaultValues: { name: "", email: "", password: "" },
    mode: "onBlur",
  })

  const handleCreateTenant = async (values: TenantFormValues) => {
    setSaving(true)
    try {
      const tenant = await api.createTenant(values)
      toast.success(`テナント「${tenant.name}」を作成しました`, {
        description: "続けて、このテナントの管理者を作成してください。",
      })
      setCreateOpen(false)
      tenantForm.reset()
      await load()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "テナントの作成に失敗しました")
    } finally {
      setSaving(false)
    }
  }

  const handleCreateAdmin = async (values: AdminFormValues) => {
    if (!adminTarget) return
    setSaving(true)
    try {
      await api.registerUser({ ...values, role: "ADMIN", tenantId: adminTarget.id })
      toast.success(`${adminTarget.name} の管理者を作成しました`, {
        description: "管理者はログイン後、最初のホテルを登録できます。",
      })
      setAdminTarget(null)
      adminForm.reset()
      await load()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "管理者の作成に失敗しました")
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (tenant: TenantSummary) => {
    try {
      await api.updateTenant(tenant.id, { isActive: !tenant.isActive })
      toast.success(tenant.isActive ? `「${tenant.name}」を停止しました` : `「${tenant.name}」を再開しました`)
      await load()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "テナントの更新に失敗しました")
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>テナント管理（運営）</CardTitle>
          <CardDescription>顧客企業（テナント）の作成・契約停止と、最初の管理者の作成を行います。</CardDescription>
        </div>
        <Button size="sm" className="gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          テナントを追加
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : tenants.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">テナントはまだありません。</p>
        ) : (
          <ul className="space-y-2">
            {tenants.map((tenant) => (
              <li key={tenant.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{tenant.name}</span>
                    <span className="text-xs text-muted-foreground">{tenant.code}</span>
                    {!tenant.isActive && <Badge variant="destructive">停止中</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    ホテル {tenant.hotelCount}件 ・ 有効なユーザー {tenant.userCount}人
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAdminTarget(tenant)}>
                    <UserPlus className="h-4 w-4" aria-hidden />
                    管理者を作成
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setToggleTarget(tenant)}>
                    {tenant.isActive ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                    {tenant.isActive ? "停止" : "再開"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>テナントを追加</DialogTitle>
            <DialogDescription>顧客企業ごとに1つ作成します。データはテナントの間で完全に分離されます。</DialogDescription>
          </DialogHeader>
          <form onSubmit={tenantForm.handleSubmit(handleCreateTenant)} noValidate className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tenant-name">テナント名</Label>
              <Input id="tenant-name" {...tenantForm.register("name")} />
              <FormFieldError message={tenantForm.formState.errors.name?.message} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tenant-code">コード</Label>
              <Input id="tenant-code" placeholder="例: fujita-kanko" {...tenantForm.register("code")} />
              <FormFieldError message={tenantForm.formState.errors.code?.message} />
            </div>
            <Button type="submit" disabled={saving} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              作成する
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={adminTarget !== null} onOpenChange={(open) => !open && setAdminTarget(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>管理者を作成（{adminTarget?.name}）</DialogTitle>
            <DialogDescription>このテナントの管理者（テナント内で最上位のロール）を作成します。</DialogDescription>
          </DialogHeader>
          <form onSubmit={adminForm.handleSubmit(handleCreateAdmin)} noValidate className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tenant-admin-name">名前</Label>
              <Input id="tenant-admin-name" {...adminForm.register("name")} />
              <FormFieldError message={adminForm.formState.errors.name?.message} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tenant-admin-email">メールアドレス</Label>
              <Input id="tenant-admin-email" type="email" autoComplete="off" {...adminForm.register("email")} />
              <FormFieldError message={adminForm.formState.errors.email?.message} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tenant-admin-password">初期パスワード</Label>
              <Input
                id="tenant-admin-password"
                type="password"
                autoComplete="new-password"
                {...adminForm.register("password")}
              />
              <p className="text-xs text-muted-foreground">8文字以上で、大文字・小文字・数字をそれぞれ1文字以上含めてください。</p>
              <FormFieldError message={adminForm.formState.errors.password?.message} />
            </div>
            <Button type="submit" disabled={saving} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              作成する
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={toggleTarget !== null}
        onOpenChange={(open) => !open && setToggleTarget(null)}
        title={toggleTarget?.isActive ? "テナントを停止しますか？" : "テナントを再開しますか？"}
        description={
          toggleTarget?.isActive
            ? `「${toggleTarget.name}」の全ユーザーが直ちにログアウトされ、ログインできなくなります。データは削除されません。`
            : `「${toggleTarget?.name}」のユーザーが再びログインできるようになります。`
        }
        confirmLabel={toggleTarget?.isActive ? "停止する" : "再開する"}
        destructive={toggleTarget?.isActive ?? false}
        onConfirm={() => {
          const target = toggleTarget
          setToggleTarget(null)
          if (target) void handleToggle(target)
        }}
      />
    </Card>
  )
}
