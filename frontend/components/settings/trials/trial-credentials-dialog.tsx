"use client"

// 発行・再発行したトライアルのログイン情報を運営に表示する。先方にそのまま送れる文面でコピーできる。

import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { TrialLoginInfo } from "@shared/types"

export function credentialsText(credentials: TrialLoginInfo, loginUrl: string): string {
  const expires = new Date(credentials.trial.expiresAt).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
  return [
    "AIレベニュー管理システム トライアルのご案内",
    `ログイン画面: ${credentials.loginUrl ?? loginUrl}`,
    `ログイン ID: ${credentials.trial.loginEmail ?? ""}`,
    `パスワード: ${credentials.password ?? "再表示未対応（パスワード再発行が必要です）"}`,
    `ご利用期限: ${expires}まで`,
    "※表示されるホテルとデータはデモ用のサンプルです。",
  ].join("\n")
}

interface Props {
  credentials: TrialLoginInfo | null
  onClose: () => void
}

export function TrialCredentialsDialog({ credentials, onClose }: Props) {
  const loginUrl = typeof window === "undefined" ? "" : window.location.origin
  // 閉じたらパスワードを含む状態・DOMを残さない
  if (!credentials) return null
  const text = credentialsText(credentials, loginUrl)

  return (
    <Dialog open={credentials !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>「{credentials.trial.name}」のログイン情報</DialogTitle>
          <DialogDescription>
            {credentials.password === null
              ? "以前に発行したパスワードは復元できません。一覧の「パスワード再発行」を行うと、次回から再表示できます。再発行するまで今のパスワードは使えます。"
              : credentials.redisplayable
                ? "一覧の「ログイン情報」から再確認できます。先方には個別 URL とパスワードを安全な方法で伝えてください。個別 URL では ID の入力は不要です。"
                : "先方に安全な方法で伝えてください。この環境ではパスワードの再表示に対応していません。"}
          </DialogDescription>
        </DialogHeader>
        <pre className="whitespace-pre-wrap break-all rounded-md border bg-muted px-3 py-2 font-mono text-xs leading-relaxed">{text}</pre>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={credentials.password === null}
            onClick={() =>
              void navigator.clipboard
                .writeText(text)
                .then(() => toast.success("コピーしました"))
                .catch(() => toast.error("コピーできませんでした。手動で控えてください"))
            }
          >
            まとめてコピー
          </Button>
          <Button size="sm" onClick={onClose}>
            閉じる
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
