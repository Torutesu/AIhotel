"use client"

// 発行・再発行したトライアルのログイン情報を1回だけ見せる。先方にそのまま送れる文面でコピーできる。

import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { TrialCredentials } from "@shared/types"

export function credentialsText(credentials: TrialCredentials, loginUrl: string): string {
  const expires = new Date(credentials.trial.expiresAt).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
  return [
    "AIレベニュー管理システム トライアルのご案内",
    `ログイン画面: ${loginUrl}`,
    `ログイン ID: ${credentials.trial.loginEmail ?? ""}`,
    `パスワード: ${credentials.password}`,
    `ご利用期限: ${expires}まで`,
    "※表示されるホテルとデータはデモ用のサンプルです。",
  ].join("\n")
}

interface Props {
  credentials: TrialCredentials | null
  onClose: () => void
}

export function TrialCredentialsDialog({ credentials, onClose }: Props) {
  const loginUrl = typeof window === "undefined" ? "" : window.location.origin
  const text = credentials ? credentialsText(credentials, loginUrl) : ""

  return (
    <Dialog open={credentials !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>「{credentials?.trial.name}」のログイン情報</DialogTitle>
          <DialogDescription>
            パスワードはこの画面を閉じると再表示できません。先方に安全な方法で伝えてください（忘れた場合は再発行できます）。
          </DialogDescription>
        </DialogHeader>
        <pre className="whitespace-pre-wrap rounded-md border bg-muted px-3 py-2 font-mono text-xs leading-relaxed">{text}</pre>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
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
