"use client"

// デモデータ表示バナー
// バックエンドに接続できずダミーデータへフォールバックした場合に表示する。
// 「モックへのサイレントフォールバック禁止」の規約に沿って、実データでないことを明示する。

import { useEffect, useState } from "react"
import { Info } from "lucide-react"
import { isDemoDataInUse, subscribeDemoData } from "@/lib/api"

export function DemoModeBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setVisible(isDemoDataInUse())
    return subscribeDemoData(() => setVisible(true))
  }, [])

  if (!visible) return null

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 border-b border-border bg-muted px-4 py-2 text-xs text-muted-foreground"
    >
      <Info className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
      <span>
        デモモードで表示しています。バックエンドに接続できないため、画面のデータはすべてサンプルです。
      </span>
    </div>
  )
}
