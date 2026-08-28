"use client"

// ログイン画面（C-6）

import { useState, type FormEvent } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { api, ApiClientError } from "@/lib/api"

export function LoginForm() {
  const { login } = useAuth()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 組織コードは、同じメールアドレスが複数の組織で使われている場合のみ必要。
  // 通常は組織ごとのURL（サブドメイン）で判別されるため入力欄を出さない
  const [tenantCode, setTenantCode] = useState("")
  const [needsTenantCode, setNeedsTenantCode] = useState(false)
  // パスワード再設定の要求（D-04）
  const [resetSent, setResetSent] = useState(false)
  const [resetSending, setResetSending] = useState(false)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await login(email, password, tenantCode || undefined)
    } catch (err) {
      if (err instanceof ApiClientError && err.errors?.some((e) => e.field === "tenantCode")) {
        setNeedsTenantCode(true)
      }
      setError(
        err instanceof ApiClientError ? err.message : "ログインに失敗しました。もう一度お試しください。"
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handlePasswordReset = async () => {
    if (!email) {
      setError("再設定リンクを送るメールアドレスを入力してください")
      return
    }
    setResetSending(true)
    setError(null)
    try {
      await api.requestPasswordReset(email)
      // アカウントの有無にかかわらず同じ表示にする（存在を推測させない）
      setResetSent(true)
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : "送信に失敗しました。もう一度お試しください。"
      )
    } finally {
      setResetSending(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-1 flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-primary" aria-hidden />
            <CardTitle className="text-2xl font-semibold tracking-tight">ホテレベ</CardTitle>
          </div>
          <CardDescription>ホテル収益管理システムにログインしてください</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="login-email">メールアドレス</Label>
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                placeholder="admin@demo-hotel.example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="login-password">パスワード</Label>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {needsTenantCode && (
              <div className="space-y-2">
                <Label htmlFor="login-tenant-code">組織コード</Label>
                <Input
                  id="login-tenant-code"
                  autoComplete="organization"
                  placeholder="例: fujita-kanko"
                  value={tenantCode}
                  onChange={(e) => setTenantCode(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  複数の組織で同じメールアドレスをご利用のため、組織コードが必要です。
                  組織のURLからログインした場合は入力不要です。
                </p>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {resetSent && (
              <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/10 p-3 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                <span>
                  ご登録のメールアドレス宛に再設定用のリンクを送信しました。メールをご確認ください。
                </span>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              ログイン
            </Button>

            <button
              type="button"
              onClick={handlePasswordReset}
              disabled={resetSending}
              className="w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50"
            >
              {resetSending ? "送信中..." : "パスワードをお忘れの方"}
            </button>
          </form>

          <div className="mt-4 rounded-lg border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
            <p className="font-medium">デモアカウント</p>
            <p>メール: admin@demo-hotel.example.com</p>
            <p>パスワード: Admin1234</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
