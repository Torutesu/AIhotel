"use client"

// 一時パスワードでログインした直後の画面（#89）。
// バックエンドはパスワードを変更するまで他の API を 403 にするため、アプリ本体の代わりにこれを出す。

import { LogOut } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/components/auth-provider"
import { PasswordChangeForm } from "@/components/settings/password-change-form"

export function ForcePasswordChange() {
  const { user, logout } = useAuth()
  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-lg space-y-6">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">{user?.name} としてログインしています</p>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => void logout()}>
            <LogOut className="h-4 w-4" aria-hidden />
            ログアウト
          </Button>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">新しいパスワードを設定してください</CardTitle>
            <CardDescription>
              管理者が発行した一時パスワードでログインしています。続けるには、ご自身だけが知るパスワードに変更してください。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PasswordChangeForm currentLabel="一時パスワード" />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
