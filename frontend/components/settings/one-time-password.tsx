"use client"

// 1回だけ表示するパスワードの欄（ユーザーの招待・一時パスワードの発行・テナントの立ち上げで共用）。
// メールで届けられなかったときだけ画面に出す。閉じると再表示できないので、コピーのボタンを添える。

import { toast } from "sonner"

import { Button } from "@/components/ui/button"

export function OneTimePasswordField({ password, label = "一時パスワード" }: { password: string; label?: string }) {
  return (
    <div className="flex items-center gap-2">
      <code aria-label={label} className="flex-1 rounded-md border bg-muted px-3 py-2 font-mono text-base tracking-wider">
        {password}
      </code>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void navigator.clipboard
            .writeText(password)
            .then(() => toast.success("コピーしました"))
            .catch(() => toast.error("コピーできませんでした。手動で控えてください"))
        }}
      >
        コピー
      </Button>
    </div>
  )
}
