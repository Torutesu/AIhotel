"use client"

// ログイン画面（C-6）

import { useSearchParams } from "next/navigation"
import { useState, type FormEvent } from "react"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Loader2, AlertCircle } from "lucide-react"
import { BrandLogo } from "@/components/brand-logo"
import { useAuth } from "@/components/auth-provider"
import { ApiClientError } from "@/lib/api"

export function LoginForm() {
  const { login } = useAuth()
  const params = useSearchParams()
  const personalTrial = process.env.NEXT_PUBLIC_DEMO_MODE === "true" && params.has("trial")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await login(email, password)
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : "ログインに失敗しました。もう一度お試しください。"
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-background p-4"
      data-demo-mode={process.env.NEXT_PUBLIC_DEMO_MODE === "true" ? "demo-mode-enabled" : undefined}
    >
      <Card className="w-full max-w-md">
        <CardHeader>
          <BrandLogo className="mb-4" />
          <h1 className="text-2xl font-bold">ログイン</h1>
          <CardDescription>{personalTrial ? "トライアル専用のログイン画面です。受け取ったパスワードを入力してください" : "ホテル収益管理システムにログインしてください"}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            {!personalTrial && <div className="space-y-2">
              <Label htmlFor="login-email">メールアドレス</Label>
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                placeholder="メールアドレスを入力"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>}
            <div className="space-y-2">
              <Label htmlFor="login-password">パスワード</Label>
              <PasswordInput
                id="login-password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              ログイン
            </Button>
          </form>


        </CardContent>
      </Card>
    </div>
  )
}
