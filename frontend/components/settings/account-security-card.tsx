"use client"

// アカウントのセキュリティ（#89）: パスワード変更と、すべての端末からのログアウト。
// どのロールでも自分のアカウントに対して使える。

import { useState } from "react"
import { LogOut } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { useAuth } from "@/components/auth-provider"
import { PasswordChangeForm } from "@/components/settings/password-change-form"
import { api, ApiClientError } from "@/lib/api"

export function AccountSecurityCard() {
  const { logout } = useAuth()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleLogoutAll = async () => {
    try {
      await api.logoutAll()
      toast.success("すべての端末からログアウトしました")
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : "ログアウトに失敗しました")
    } finally {
      // この端末のトークンは api.logoutAll が消しているので、画面もログイン前に戻す
      await logout()
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>アカウントのセキュリティ</CardTitle>
        <CardDescription>自分のパスワードの変更と、ログイン中の端末の管理を行います。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <PasswordChangeForm />
        <Separator />
        <div className="space-y-2">
          <p className="text-sm font-medium">すべての端末からログアウト</p>
          <p className="text-xs text-muted-foreground">
            端末をなくした、共用のパソコンでログアウトし忘れた、などの場合に使います。この端末もログアウトします。
          </p>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setConfirmOpen(true)}>
            <LogOut className="h-4 w-4" aria-hidden />
            すべての端末からログアウト
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="すべての端末からログアウトしますか？"
        description="この端末を含め、ログイン中のすべての端末でログアウトします。"
        confirmLabel="ログアウトする"
        onConfirm={() => {
          setConfirmOpen(false)
          void handleLogoutAll()
        }}
      />
    </Card>
  )
}
