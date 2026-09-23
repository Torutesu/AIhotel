"use client"

// ルートのエラー境界（#91）。タブ単位の ErrorBoundary の外（レイアウト・認証など）で
// 描画例外が起きたときに、真っ白な画面ではなく再試行の手段を出す。

import { AlertCircle } from "lucide-react"

import { Button } from "@/components/ui/button"

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <AlertCircle className="h-8 w-8 text-destructive" aria-hidden />
      <div className="space-y-1" role="alert">
        <p className="text-sm font-medium text-foreground">画面を表示できませんでした</p>
        <p className="text-sm text-muted-foreground">再試行しても直らない場合は、ページを再読み込みしてください。</p>
      </div>
      <Button onClick={reset}>再試行</Button>
    </div>
  )
}
