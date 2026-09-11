"use client"

// データ取得失敗時の共通表示（U-15）
// 「ローディング＋エラー＋再試行」を各タブで書き分けていたものをここへ集約する。

import { AlertCircle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface ErrorStateProps {
  /** 表示するエラーメッセージ */
  message: string
  /** 再試行ハンドラ。省略すると再試行ボタンを出さない */
  onRetry?: () => void
  /** 再試行ボタンのラベル */
  retryLabel?: string
  className?: string
}

/** Card の中身として使うエラー表示（外枠は呼び出し側が用意する） */
export function ErrorState({ message, onRetry, retryLabel = "再試行", className }: ErrorStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-3 py-8 text-center", className)}>
      <AlertCircle className="h-6 w-6 text-destructive" aria-hidden />
      <p className="text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="gap-2">
          <RefreshCw className="h-4 w-4" aria-hidden />
          {retryLabel}
        </Button>
      )}
    </div>
  )
}

/** Card で囲ったエラー表示（セクション全体を置き換える用途） */
export function ErrorCard({ message, onRetry, retryLabel, className }: ErrorStateProps) {
  return (
    <Card className={className}>
      <CardContent className="py-2">
        <ErrorState message={message} onRetry={onRetry} retryLabel={retryLabel} />
      </CardContent>
    </Card>
  )
}
