"use client"

// 招待の受諾とパスワード再設定の共通画面（SAAS_DECISIONS.md D-04）。
// どちらもURLのトークンで本人確認し、新しいパスワードを設定する点は同じ。

import { useState, type FormEvent } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react"
import { api, ApiClientError } from "@/lib/api"

// バックエンドの strongPasswordSchema と同じ条件。
// 送信前に画面で示すことで、往復してから怒られる体験を避ける
const RULES = [
  { label: "8文字以上", test: (v: string) => v.length >= 8 },
  { label: "大文字を含む", test: (v: string) => /[A-Z]/.test(v) },
  { label: "小文字を含む", test: (v: string) => /[a-z]/.test(v) },
  { label: "数字を含む", test: (v: string) => /[0-9]/.test(v) },
]

export type SetPasswordMode = "invitation" | "reset"

const COPY: Record<SetPasswordMode, { title: string; description: string; submit: string }> = {
  invitation: {
    title: "パスワードの設定",
    description: "アカウントで使用するパスワードを設定してください",
    submit: "設定してはじめる",
  },
  reset: {
    title: "パスワードの再設定",
    description: "新しいパスワードを設定してください",
    submit: "再設定する",
  },
}

export function SetPasswordForm({ mode, token }: { mode: SetPasswordMode; token: string | null }) {
  const copy = COPY[mode]
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const unmetRules = RULES.filter((rule) => !rule.test(password))
  const mismatched = confirmPassword.length > 0 && password !== confirmPassword
  const canSubmit = Boolean(token) && unmetRules.length === 0 && !mismatched && confirmPassword.length > 0

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!token) return
    setSubmitting(true)
    setError(null)
    try {
      if (mode === "invitation") {
        await api.acceptInvitation(token, password)
      } else {
        await api.confirmPasswordReset(token, password)
      }
      setDone(true)
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : "設定に失敗しました。時間をおいて再度お試しください。"
      )
    } finally {
      setSubmitting(false)
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
          <CardDescription>{done ? "設定が完了しました" : copy.description}</CardDescription>
        </CardHeader>
        <CardContent>
          {!token ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>
                リンクが正しくありません。メールに記載されたURLをそのまま開いてください。
              </span>
            </div>
          ) : done ? (
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/10 p-3 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                <span>パスワードを設定しました。ログイン画面からご利用ください。</span>
              </div>
              <Button asChild className="w-full">
                <a href="/">ログイン画面へ</a>
              </Button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <h1 className="text-sm font-medium">{copy.title}</h1>
              <div className="space-y-2">
                <Label htmlFor="new-password">新しいパスワード</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <ul className="space-y-0.5 text-xs">
                  {RULES.map((rule) => {
                    const met = rule.test(password)
                    return (
                      <li
                        key={rule.label}
                        className={met ? "text-primary" : "text-muted-foreground"}
                      >
                        {met ? "✓" : "・"} {rule.label}
                      </li>
                    )
                  })}
                </ul>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">確認のため再入力</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
                {mismatched && (
                  <p className="text-xs text-destructive">パスワードが一致しません</p>
                )}
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={submitting || !canSubmit}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {copy.submit}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
